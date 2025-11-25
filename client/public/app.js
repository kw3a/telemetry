let isRunning = false;
let buffer = [];
let keyDownTimes = {};
let interval = null;

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const sessionInput = document.getElementById('sessionid');

startBtn.onclick = () => {
  const userID = sessionInput.value.trim();
  if (!userID) { alert("Enter session ID"); return; }

  isRunning = true;
  buffer = [];
  keyDownTimes = {};

  interval = setInterval(() => sendBatch(userID), 1000);
};

stopBtn.onclick = () => {
  isRunning = false;
  clearInterval(interval);
};

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
  buffer.push({
    key: e.code,
    pressed_at: downTime,
    released_at: upTime
  });
  delete keyDownTimes[e.code];
});

function sendBatch(userID) {
  if (!isRunning || buffer.length === 0) return;

  const batch = buffer.slice();
  buffer = [];

  fetch("http://localhost:8080/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userID,
      events: batch
    })
  });
}

