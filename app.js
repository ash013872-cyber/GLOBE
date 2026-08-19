const $ = (id) => document.getElementById(id);
const progressCircle = $("gaugeProgress");
const circumference = 2 * Math.PI * 112;
progressCircle.style.strokeDasharray = circumference;
progressCircle.style.strokeDashoffset = circumference;

const TEST_HOST = "https://speed.cloudflare.com";
const state = {
  running: false,
  stopped: false,
  xhr: null,
  download: null,
  upload: null,
  ping: null,
  jitter: null,
};

function setStageProgress(percent) {
  const value = Math.max(0, Math.min(100, percent));
  $("progressBar").style.width = `${value}%`;
}

function setSpeed(value, unit = "Mbps") {
  $("speedValue").textContent = Number.isFinite(value) ? value.toFixed(value >= 100 ? 0 : 1) : "0.0";
  $("speedUnit").textContent = unit;

  if (unit !== "Mbps" || !Number.isFinite(value)) return;
  // The visible scale is 0–100+ Mbps. Faster connections still show the real
  // number in the center while the ring caps cleanly at the 100+ mark.
  const meterPercent = Math.min(100, Math.max(0, value));
  progressCircle.style.strokeDashoffset = circumference * (1 - meterPercent / 100);
}

function format(value) {
  return Number.isFinite(value) ? (value >= 100 ? value.toFixed(0) : value.toFixed(1)) : "—";
}

function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setStage(stage) {
  document.querySelectorAll("[data-stage-dot]").forEach((dot) => {
    const active = dot.dataset.stageDot === stage;
    dot.classList.toggle("active", active);
    dot.classList.toggle("done", stage === "upload" && dot.dataset.stageDot === "download");
  });
}

function getNetworkInfo() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  $("onlineState").textContent = navigator.onLine ? "Online" : "Offline";
  if (!connection) return;
  $("connectionType").textContent = connection.type || "Browser reported";
  $("downlinkEstimate").textContent = Number.isFinite(connection.downlink) ? `${connection.downlink} Mbps` : "—";
  $("effectiveType").textContent = connection.effectiveType || "—";
}

function setButtons(mode) {
  const start = $("startButton");
  const stop = $("stopButton");
  const retry = $("retryButton");

  start.hidden = mode === "running" || mode === "error";
  stop.hidden = mode !== "running";
  retry.hidden = mode !== "error" && mode !== "stopped";
  start.disabled = mode === "running";
}

function cancelCurrentTransfer() {
  if (state.xhr) {
    state.xhr.abort();
    state.xhr = null;
  }
}

function xhrTransfer({ method, url, body, totalBytes, progressBase, progressSpan, timeout = 30000 }) {
  return new Promise((resolve, reject) => {
    if (state.stopped) {
      reject(new Error("Stopped"));
      return;
    }

    const xhr = new XMLHttpRequest();
    state.xhr = xhr;
    const started = performance.now();
    let lastLoaded = 0;
    let lastTime = started;

    xhr.open(method, url, true);
    xhr.timeout = timeout;
    xhr.responseType = "arraybuffer";
    xhr.setRequestHeader("Cache-Control", "no-cache");

    const onProgress = (loaded) => {
      const now = performance.now();
      const elapsed = (now - started) / 1000;
      if (elapsed > 0) {
        const mbps = (loaded * 8) / elapsed / 1e6;
        setSpeed(mbps);
      }
      if (totalBytes) {
        const fraction = Math.min(1, loaded / totalBytes);
        setStageProgress(progressBase + fraction * progressSpan);
      }
      lastLoaded = loaded;
      lastTime = now;
    };

    xhr.onprogress = (event) => onProgress(event.loaded);
    if (xhr.upload) xhr.upload.onprogress = (event) => onProgress(event.loaded);

    xhr.onload = () => {
      state.xhr = null;
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Transfer failed (${xhr.status})`));
        return;
      }
      const elapsed = (performance.now() - started) / 1000;
      const bytes = totalBytes || lastLoaded;
      if (!bytes || elapsed <= 0) {
        reject(new Error("Transfer contained no measurable data"));
        return;
      }
      resolve((bytes * 8) / elapsed / 1e6);
    };

    xhr.onerror = () => {
      state.xhr = null;
      reject(new Error("Network transfer failed"));
    };
    xhr.ontimeout = () => {
      state.xhr = null;
      reject(new Error("Transfer timed out"));
    };
    xhr.onabort = () => {
      state.xhr = null;
      reject(new Error(state.stopped ? "Stopped" : "Transfer aborted"));
    };

    try {
      xhr.send(body || null);
    } catch (error) {
      state.xhr = null;
      reject(error);
    }
  });
}

async function measureDownload() {
  // Smaller staged transfers finish reliably on phones while still giving the
  // test enough data to reach a useful throughput measurement.
  const sizes = [1_000_000, 3_000_000, 5_000_000];
  const results = [];

  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    const speed = await xhrTransfer({
      method: "GET",
      url: `${TEST_HOST}/__down?bytes=${size}&cacheBust=${crypto.randomUUID()}`,
      totalBytes: size,
      progressBase: i * 18,
      progressSpan: 18,
      timeout: 30000,
    });
    results.push(speed);
    $("downloadResult").textContent = format(speed);
    await sleep(120);
  }

  return average(results.slice(-2));
}

async function measureUpload() {
  const sizes = [500_000, 1_000_000, 2_000_000];
  const results = [];

  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    const body = new Uint8Array(size);
    const speed = await xhrTransfer({
      method: "POST",
      url: `${TEST_HOST}/__up?cacheBust=${crypto.randomUUID()}`,
      body,
      totalBytes: size,
      progressBase: 55 + i * 14,
      progressSpan: 14,
      timeout: 30000,
    });
    results.push(speed);
    $("uploadResult").textContent = format(speed);
    await sleep(120);
  }

  return average(results.slice(-2));
}

async function measurePing() {
  const samples = [];
  for (let i = 0; i < 5; i++) {
    if (state.stopped) throw new Error("Stopped");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const started = performance.now();
    try {
      const response = await fetch(`${TEST_HOST}/cdn-cgi/trace?cacheBust=${crypto.randomUUID()}`, {
        cache: "no-store",
        mode: "cors",
        signal: controller.signal,
      });
      if (response.ok) samples.push(performance.now() - started);
    } catch {
      // A latency sample can fail without invalidating the throughput test.
    } finally {
      clearTimeout(timer);
    }
  }
  if (!samples.length) return { avg: NaN, jitter: NaN };
  const jitterValues = samples.slice(1).map((value, index) => Math.abs(value - samples[index]));
  return { avg: average(samples), jitter: average(jitterValues) };
}

function stopTest() {
  if (!state.running) return;
  state.stopped = true;
  cancelCurrentTransfer();
  $("connectionStatus").textContent = "Stopped";
  $("modeLabel").textContent = "Test stopped";
  $("testState").textContent = "Test stopped. You can retry when ready.";
  setButtons("stopped");
  state.running = false;
}

async function runTest() {
  if (state.running || !navigator.onLine) return;

  state.running = true;
  state.stopped = false;
  state.download = null;
  state.upload = null;
  state.ping = null;
  state.jitter = null;
  setButtons("running");
  $("connectionStatus").textContent = "Testing";
  $("modeLabel").textContent = "Live throughput test";
  $("testState").textContent = "Checking download speed…";
  setStage("download");
  setStageProgress(0);
  setSpeed(0);
  const started = performance.now();

  try {
    state.download = await measureDownload();
    if (state.stopped) throw new Error("Stopped");
    $("downloadResult").textContent = format(state.download);
    setSpeed(state.download);

    setStage("upload");
    $("testState").textContent = "Checking upload speed…";
    state.upload = await measureUpload();
    if (state.stopped) throw new Error("Stopped");
    $("uploadResult").textContent = format(state.upload);
    setSpeed(state.upload);

    $("testState").textContent = "Measuring ping and jitter…";
    const latency = await measurePing();
    state.ping = latency.avg;
    state.jitter = latency.jitter;
    $("pingResult").textContent = format(state.ping);
    $("jitterResult").textContent = format(state.jitter);

    setStageProgress(100);
    $("testState").textContent = "Test complete";
    $("modeLabel").textContent = "Test complete";
    $("connectionStatus").textContent = "Complete";
    setButtons("done");
  } catch (error) {
    if (state.stopped) {
      setButtons("stopped");
    } else {
      console.error("GLOBE test error:", error);
      $("testState").textContent = "Test failed. You can retry the test.";
      $("modeLabel").textContent = "Test needs another try";
      $("connectionStatus").textContent = "Error";
      setButtons("error");
    }
  } finally {
    state.xhr = null;
    state.running = false;
    $("elapsed").textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`;
  }
}

$("startButton").addEventListener("click", runTest);
$("stopButton").addEventListener("click", stopTest);
$("retryButton").addEventListener("click", runTest);
window.addEventListener("online", getNetworkInfo);
window.addEventListener("offline", getNetworkInfo);
getNetworkInfo();
setButtons("done");
