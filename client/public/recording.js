// Recording (MediaMTX WHIP) client logic extracted from publish2.html and adapted to share UI
(function () {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const togglePreviewBtn = document.getElementById('togglePreviewBtn');
  const preview = document.getElementById('preview');
  const previewPlaceholder = document.getElementById('previewPlaceholder');
  const logEl = document.getElementById('log');
  // Shared session id input (also used as publish path)
  const sessionInput = document.getElementById('sessionid');

  const micBtn = document.getElementById('micBtn');
  const camBtn = document.getElementById('camBtn');
  const screenBtn = document.getElementById('screenBtn');
  const micStateEl = document.getElementById('micState');
  const camStateEl = document.getElementById('camState');
  const screenStateEl = document.getElementById('screenState');

  const BASE_URL = 'http://localhost:8889/';

  let pc = null;
  let localStream = null;
  let whipResourceLocation = null;

  // Streams originales (para detenerlos al final)
  let screenStream = null;
  let camStream = null;

  // Streams used only for preview & permission probing (may be stopped/replaced)
  let previewScreenStream = null;
  let previewCamStream = null;
  let previewMicTrack = null;
  let previewCanvas = null;
  let previewCanvasStream = null;
  let previewDrawRaf = null;

  function log(...args) {
    console.log(...args);
    const text = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ') + '\n';
    logEl.textContent += text;

    // Limit log size to prevent memory issues (e.g., 10k chars)
    if (logEl.textContent.length > 10000) {
      logEl.textContent = logEl.textContent.slice(-10000);
    }

    logEl.scrollTop = logEl.scrollHeight;
  }

  function setStateEl(el, state) {
    el.classList.remove('state-not-available', 'state-not-allowed', 'state-working');
    if (state === 'not-available') {
      el.textContent = 'no disponible';
      el.classList.add('state-not-available');
    } else if (state === 'not-allowed') {
      el.textContent = 'no permitido';
      el.classList.add('state-not-allowed');
    } else if (state === 'working') {
      el.textContent = 'funcionando';
      el.classList.add('state-working');
    } else {
      el.textContent = state;
    }
  }

  function preferH264(sdp) {
    const lines = sdp.split("\r\n");
    const mLineIndex = lines.findIndex(l => l.startsWith("m=video"));
    if (mLineIndex === -1) return sdp;
    const h264pt = lines
      .filter(l => l.startsWith("a=rtpmap") && l.toLowerCase().includes("h264"))
      .map(l => l.split(" ")[0].split(":")[1])[0];
    if (!h264pt) return sdp;
    const parts = lines[mLineIndex].split(" ");
    const newMLine = parts.slice(0, 3).join(" ") + " " + h264pt + " " + parts.slice(3).filter(p => p !== h264pt).join(" ");
    lines[mLineIndex] = newMLine;
    return lines.join("\r\n");
  }

  // --- Permissions & availability helpers ---
  async function checkDevicesAndPermissions() {
    try {
      if (navigator.permissions) {
        try {
          const camPerm = await navigator.permissions.query({ name: 'camera' });
          updateStateFromPermission('cam', camPerm.state);
          camPerm.onchange = () => updateStateFromPermission('cam', camPerm.state);
        } catch (e) {
          updateStateFromPermission('cam', 'unknown');
        }
        try {
          const micPerm = await navigator.permissions.query({ name: 'microphone' });
          updateStateFromPermission('mic', micPerm.state);
          micPerm.onchange = () => updateStateFromPermission('mic', micPerm.state);
        } catch (e) {
          updateStateFromPermission('mic', 'unknown');
        }
      } else {
        updateStateFromPermission('cam', 'unknown');
        updateStateFromPermission('mic', 'unknown');
      }
    } catch (e) {
      console.warn('Permission query failed', e);
    }

    if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
      setStateEl(screenStateEl, 'not-allowed');
    } else {
      setStateEl(screenStateEl, 'not-available');
    }

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasCam = devices.some(d => d.kind === 'videoinput');
        const hasMic = devices.some(d => d.kind === 'audioinput');
        if (!hasCam) setStateEl(camStateEl, 'not-available');
        if (!hasMic) setStateEl(micStateEl, 'not-available');
      }
    } catch { }
  }

  function updateStateFromPermission(which, permState) {
    if (which === 'cam') {
      if (permState === 'granted') setStateEl(camStateEl, 'working');
      else if (permState === 'denied') setStateEl(camStateEl, 'not-allowed');
      else setStateEl(camStateEl, 'not-available');
    } else if (which === 'mic') {
      if (permState === 'granted') setStateEl(micStateEl, 'working');
      else if (permState === 'denied') setStateEl(micStateEl, 'not-allowed');
      else setStateEl(micStateEl, 'not-available');
    }
  }

  // Request permissions on load (probing only)
  async function probePermissionsOnLoad() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      previewCamStream = new MediaStream();
      if (stream.getVideoTracks()[0]) previewCamStream.addTrack(stream.getVideoTracks()[0]);
      if (stream.getAudioTracks()[0]) previewMicTrack = stream.getAudioTracks()[0];
      setStateEl(camStateEl, stream.getVideoTracks().length ? 'working' : camStateEl.textContent);
      setStateEl(micStateEl, stream.getAudioTracks().length ? 'working' : micStateEl.textContent);
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setStateEl(camStateEl, 'not-allowed');
        setStateEl(micStateEl, 'not-allowed');
      } else {
        log('Probe getUserMedia failed:', err);
      }
    }

    if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
        previewScreenStream = s;
        setStateEl(screenStateEl, 'working');
      } catch (err) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setStateEl(screenStateEl, 'not-allowed');
        } else {
          setStateEl(screenStateEl, 'not-available');
        }
        log('Probe getDisplayMedia failed (ignored):', err);
      }
    } else {
      setStateEl(screenStateEl, 'not-available');
    }

    updatePreviewFromAvailableStreams();
  }

  function stopPreviewProbes() {
    if (previewScreenStream) {
      previewScreenStream.getTracks().forEach(t => t.stop());
      previewScreenStream = null;
    }
    if (previewCamStream) {
      previewCamStream.getTracks().forEach(t => t.stop());
      previewCamStream = null;
    }
    if (previewMicTrack) {
      try { previewMicTrack.stop(); } catch (e) { }
      previewMicTrack = null;
    }
    stopPreviewCanvas();
  }

  // --- Preview rendering (small 480p canvas mixing for local preview) ---
  function ensurePreviewCanvas() {
    if (!previewCanvas) {
      previewCanvas = document.createElement('canvas');
      previewCanvas.width = 854;
      previewCanvas.height = 480;
    }
  }

  function startPreviewCanvasMix(screenVidEl, camVidEl) {
    ensurePreviewCanvas();
    const ctx = previewCanvas.getContext('2d');
    function draw() {
      if (screenVidEl && screenVidEl.readyState >= 2) {
        ctx.drawImage(screenVidEl, 0, 0, previewCanvas.width, previewCanvas.height);
      } else {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
      }
      if (camVidEl && camVidEl.readyState >= 2) {
        const camW = Math.round(previewCanvas.width * 0.25);
        const camH = Math.round(camW * 9 / 16);
        ctx.drawImage(camVidEl, previewCanvas.width - camW - 12, 12, camW, camH);
      }
      previewDrawRaf = requestAnimationFrame(draw);
    }
    draw();
    if (previewCanvasStream) {
      previewCanvasStream.getTracks().forEach(t => t.stop());
    }
    previewCanvasStream = previewCanvas.captureStream(30);
    preview.srcObject = previewCanvasStream;
    previewPlaceholder.style.display = 'none';
    preview.style.display = 'block';
  }

  function stopPreviewCanvas() {
    if (previewDrawRaf) {
      cancelAnimationFrame(previewDrawRaf);
      previewDrawRaf = null;
    }
    if (previewCanvasStream) {
      previewCanvasStream.getTracks().forEach(t => t.stop());
      previewCanvasStream = null;
    }
    if (previewCanvas) {
      previewCanvas.width = previewCanvas.width;
    }
  }

  function updatePreviewFromAvailableStreams() {
    if (preview.hidden) return;
    stopPreviewCanvas();
    const screenVideo = document.createElement('video');
    const camVideo = document.createElement('video');
    const hasScreen = !!previewScreenStream;
    const hasCam = !!previewCamStream;
    if (hasScreen) {
      screenVideo.srcObject = previewScreenStream;
      screenVideo.muted = true; screenVideo.playsInline = true; screenVideo.play().catch(() => { });
    }
    if (hasCam) {
      camVideo.srcObject = previewCamStream;
      camVideo.muted = true; camVideo.playsInline = true; camVideo.play().catch(() => { });
    }
    if (hasScreen || hasCam) {
      startPreviewCanvasMix(hasScreen ? screenVideo : null, hasCam ? camVideo : null);
    } else {
      preview.srcObject = null;
      preview.style.display = 'none';
      previewPlaceholder.style.display = 'flex';
    }
  }

  async function requestMicrophone() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (previewMicTrack) { try { previewMicTrack.stop(); } catch (e) { } }
      previewMicTrack = s.getAudioTracks()[0];
      setStateEl(micStateEl, 'working');
      updatePreviewFromAvailableStreams();
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') setStateEl(micStateEl, 'not-allowed');
      else setStateEl(micStateEl, 'not-available');
      log('requestMicrophone error:', err);
    }
  }

  async function requestCamera() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 } }, audio: false });
      if (previewCamStream) previewCamStream.getTracks().forEach(t => t.stop());
      previewCamStream = new MediaStream();
      if (s.getVideoTracks()[0]) previewCamStream.addTrack(s.getVideoTracks()[0]);
      setStateEl(camStateEl, 'working');
      updatePreviewFromAvailableStreams();
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') setStateEl(camStateEl, 'not-allowed');
      else setStateEl(camStateEl, 'not-available');
      log('requestCamera error:', err);
    }
  }

  async function requestScreen() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      setStateEl(screenStateEl, 'not-available');
      return;
    }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 } });
      if (previewScreenStream) previewScreenStream.getTracks().forEach(t => t.stop());
      previewScreenStream = s;
      setStateEl(screenStateEl, 'working');
      updatePreviewFromAvailableStreams();
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') setStateEl(screenStateEl, 'not-allowed');
      else setStateEl(screenStateEl, 'not-available');
      log('requestScreen error:', err);
    }
  }

  async function startMixedStream() {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 360 } },
      audio: true
    });
    const camTrack = camStream.getVideoTracks()[0];
    const micTrack = camStream.getAudioTracks()[0];
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false
    });
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d');
    const screenVideo = document.createElement('video');
    screenVideo.srcObject = screenStream; screenVideo.play();
    const camVideo = document.createElement('video');
    camVideo.srcObject = new MediaStream([camTrack]); camVideo.play();
    function draw() {
      ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
      const camW = 320, camH = 180;
      ctx.drawImage(camVideo, canvas.width - camW - 20, 20, camW, camH);
      requestAnimationFrame(draw);
    }
    draw();
    const mixedStream = canvas.captureStream(30);
    if (micTrack) mixedStream.addTrack(micTrack);
    return mixedStream;
  }

  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    log('Iniciando captura de pantalla + cámara...');
    try {
      stopPreviewProbes();
      localStream = await startMixedStream();
    } catch (err) {
      log('Error al obtener medios:', err);
      startBtn.disabled = false;
      return;
    }
    preview.srcObject = localStream;
    previewPlaceholder.style.display = 'none';
    preview.style.display = 'block';
    pc = new RTCPeerConnection({ iceServers: [] });
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    pc.addEventListener('icecandidate', e => {
      if (e.candidate) log('ICE candidate local:', e.candidate.candidate);
      else log('ICE gathering finished.');
    });
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      let h264Sdp = preferH264(offer.sdp);
      const path = (sessionInput.value || '').trim().replace(/^\/+|\/+$/g, '');
      const publishUrl = BASE_URL + encodeURIComponent(path) + '/whip';
      log('POST SDP offer a', publishUrl);
      const resp = await fetch(publishUrl, { method: 'POST', headers: { 'Content-Type': 'application/sdp', 'Accept': 'application/sdp' }, body: h264Sdp });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '<no body>');
        throw new Error(`HTTP ${resp.status} ${resp.statusText} - ${text}`);
      }
      const answerSDP = await resp.text();
      whipResourceLocation = resp.headers.get('Location') || null;
      log('Respuesta OK. Location:', whipResourceLocation);
      log('SDP answer recibida:\n', answerSDP.slice(0, 400) + (answerSDP.length > 400 ? '\n...(truncado)' : ''));
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSDP });
      log('RemoteDescription set. Transmisión en curso.');
      stopBtn.disabled = false;
    } catch (err) {
      log('Error publicando stream:', err);
      pc?.close(); pc = null;
      localStream?.getTracks().forEach(t => t.stop());
      localStream = null;
      stopAllDevices();
      startBtn.disabled = false;
    }
  });

  stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;
    log('Deteniendo transmisión...');
    try {
      if (whipResourceLocation) {
        let url = whipResourceLocation;
        if (!/^https?:\/\//i.test(url)) {
          const base = new URL(BASE_URL + (sessionInput.value.trim().replace(/^\/+|\/+$/g, '')) + '/whip');
          url = new URL(url, base).toString();
        }
        log('Enviando DELETE a', url);
        await fetch(url, { method: 'DELETE' }).catch(e => log('DELETE error (ignore):', e));
        whipResourceLocation = null;
      }
      pc?.getSenders().forEach(s => { try { s.track?.stop(); } catch (e) { } });
      pc?.close(); pc = null;
      localStream?.getTracks().forEach(t => t.stop());
      localStream = null;
      preview.srcObject = null;
      stopAllDevices();
      log('Transmisión detenida.');
    } finally {
      startBtn.disabled = false;
    }
  });

  function stopAllDevices() {
    if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
    if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
    stopPreviewProbes();
    preview.srcObject = null;
    previewPlaceholder.style.display = 'flex';
    preview.style.display = 'none';
  }

  togglePreviewBtn.addEventListener('click', () => {
    const hidden = preview.hidden || preview.style.display === 'none';
    if (hidden) {
      preview.hidden = false;
      togglePreviewBtn.textContent = 'Ocultar vista previa';
      updatePreviewFromAvailableStreams();
    } else {
      preview.hidden = true;
      togglePreviewBtn.textContent = 'Mostrar vista previa';
      preview.srcObject = null;
      preview.style.display = 'none';
      previewPlaceholder.style.display = 'none';
      stopPreviewCanvas();
    }
  });

  micBtn.addEventListener('click', async () => { await requestMicrophone(); });
  camBtn.addEventListener('click', async () => { await requestCamera(); });
  screenBtn.addEventListener('click', async () => { await requestScreen(); });

  window.addEventListener('load', async () => {
    await checkDevicesAndPermissions();
    await probePermissionsOnLoad();
    togglePreviewBtn.textContent = 'Ocultar vista previa';
  });

  window.addEventListener('beforeunload', () => {
    if (pc) pc.close();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    stopAllDevices();
  });

})();
