let isRunning = false;
let buffer = [];
let keyDownTimes = {};
let lastEventDownTime = null;
let lastEventUpTime = null;
let interval = null;
let timerInterval = null;
let secondsElapsed = 0;

const startBtn = document.getElementById('startBtn');
const startTelemetryBtn = document.getElementById('startTelemetryBtn');
const stopBtn = document.getElementById('stopBtn');
const sessionInput = document.getElementById('sessionid');
const timerProgress = document.getElementById('timerProgress');
const timerLabel = document.getElementById('timerLabel');

function startTelemetry() {
  const userID = sessionInput.value.trim();
  if (!userID) { alert("Enter session ID"); return; }

  if (isRunning) return; // Already running

  isRunning = true;
  buffer = [];
  keyDownTimes = {};
  lastEventDownTime = null;
  lastEventUpTime = null;
  secondsElapsed = 0;

  updateTimerUI();

  // Send every 1 minute (60000 ms)
  interval = setInterval(() => {
    sendBatch(userID);
    secondsElapsed = 0; // Reset timer
    updateTimerUI();
  }, 60000);

  // Update timer every second
  timerInterval = setInterval(() => {
    secondsElapsed++;
    updateTimerUI();
  }, 1000);

  // Update UI state
  startBtn.disabled = true;
  startTelemetryBtn.disabled = true;
  stopBtn.disabled = false;
  sessionInput.disabled = true;
}

function stopTelemetry() {
  isRunning = false;
  clearInterval(interval);
  clearInterval(timerInterval);
  interval = null;
  timerInterval = null;
  secondsElapsed = 0;
  updateTimerUI();

  startBtn.disabled = false;
  startTelemetryBtn.disabled = false;
  stopBtn.disabled = true;
  sessionInput.disabled = false;
}

function updateTimerUI() {
  if (!timerProgress || !timerLabel) return;
  const percentage = Math.min((secondsElapsed / 60) * 100, 100);
  timerProgress.style.width = `${percentage}%`;
  timerLabel.textContent = `${secondsElapsed}s`;
}

// "Start Recording + Telemetry" is handled by recording.js for media, 
// but we also need to start telemetry.
// recording.js attaches its own listener. We attach ours here.
startBtn.addEventListener('click', () => {
  startTelemetry();
});

// "Start Telemetry Only"
startTelemetryBtn.addEventListener('click', () => {
  startTelemetry();
});

stopBtn.addEventListener('click', () => {
  stopTelemetry();
  // recording.js also listens to this to stop media
});

document.getElementById("view").onclick = () => {
  const userID = sessionInput.value.trim();
  if (!userID) { alert("Enter session ID"); return; }

  fetch(`http://localhost:8080/profile/${userID}`)
    .then(r => r.json())
    .then(data => {
      document.getElementById("result").textContent = JSON.stringify(data, null, 2);
    })
    .catch(() => {
      document.getElementById("result").textContent = "Profile not found";
    });
};

document.addEventListener("keydown", (e) => {
  if (!isRunning) return;
  if (!keyDownTimes[e.code]) {
    keyDownTimes[e.code] = performance.now();
  }
});

document.addEventListener("keyup", (e) => {
  if (!isRunning) return;
  const downTime = keyDownTimes[e.code];
  if (!downTime) return;

  const upTime = performance.now();

  // Calculate raw features (rounded to integer)
  const ud = Math.round(upTime - downTime); // Dwell
  let du1 = 0; // Flight
  let dd = 0;
  let uu = 0;
  let du2 = 0;

  if (lastEventDownTime !== null) {
    dd = Math.round(downTime - lastEventDownTime);
    du2 = Math.round(upTime - lastEventDownTime);
  }
  if (lastEventUpTime !== null) {
    du1 = Math.round(downTime - lastEventUpTime);
    uu = Math.round(upTime - lastEventUpTime);
  }

  lastEventDownTime = downTime;
  lastEventUpTime = upTime;

  buffer.push({
    ud: ud,
    du1: du1,
    dd: dd,
    uu: uu,
    du2: du2
  });
  delete keyDownTimes[e.code];
});

function calculateStats(values) {
  // Filter out 0s (assuming 0 means "not applicable" for the first keystroke of the window)
  const validValues = values.filter(v => v !== 0); // Strict inequality if we allow negative? No, time diffs.
  // Actually, Flight Time (DU1) can be negative if overlap? 
  // "Flight time is the time between the release of a key and the press of the next".
  // If next key pressed BEFORE release of previous, it is negative (overlap).
  // So we should NOT filter out negative values, only "0" if it means "missing".
  // But wait, if we initialize to 0, and it IS 0 (very rare), we might filter it.
  // Let's assume 0 is missing for DD/UU/DU2/DU1 on first key.
  // But UD is never 0 (unless instant).

  // Better approach: use null or undefined for missing, but we used 0.
  // Let's stick to filtering 0 for now as it's the initialization value for "no previous key".

  if (validValues.length === 0) {
    return { mean: 0, std_dev: 0 };
  }

  const sum = validValues.reduce((a, b) => a + b, 0);
  const mean = sum / validValues.length;

  const variance = validValues.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / validValues.length;
  const stdDev = Math.sqrt(variance);

  return {
    mean: Math.round(mean), // Round mean to integer
    std_dev: Math.round(stdDev) // Round stdDev to integer
  };
}

function sendBatch(userID) {
  if (!isRunning) {
    return;
  }

  try {
    // Aggregate
    const stats = {
      ud: calculateStats(buffer.map(e => e.ud)),
      du1: calculateStats(buffer.map(e => e.du1)),
      dd: calculateStats(buffer.map(e => e.dd)),
      uu: calculateStats(buffer.map(e => e.uu)),
      du2: calculateStats(buffer.map(e => e.du2))
    };

    fetch("http://localhost:8080/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userID,
        stats: stats
      })
    }).catch(err => console.error("Error sending telemetry:", err));

  } catch (err) {
    console.error("Error in sendBatch aggregation:", err);
  } finally {
    // Reset buffer and state for independence, ensuring it happens even if aggregation fails
    buffer = [];
    lastEventDownTime = null;
    lastEventUpTime = null;
  }
}

