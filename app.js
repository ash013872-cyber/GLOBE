import SpeedTest from "https://unpkg.com/@cloudflare/speedtest@1.12.1/dist/speedtest.js";

const $ = (id) => document.getElementById(id);
const gaugeProgress = $("gaugeProgress");
const circumference = 2 * Math.PI * 112;
const SCALE_MAX = 100;

gaugeProgress.style.strokeDasharray = circumference;
gaugeProgress.style.strokeDashoffset = circumference;

const state = {
  engine: null,
  running: false,
  stage: "idle",
  startedAt: 0,
  timer: null,
  downloadPoints: 0,
  uploadPoints: 0,
};

const measurements = [
  { type: "download", bytes: 1e6, count: 3 },
  { type: "download", bytes: 1e7, count: 2 },
  { type: "upload", bytes: 1e6, count: 3 },
  { type: "upload", bytes: 1e7, count: 2 },
  { type: "latency", numPackets: 10 },
];

function setGauge(mbps) {
  const value = Number.isFinite(mbps) ? Math.max(0, mbps) : 0;
  const percent = Math.min(100, (value / SCALE_MAX) * 100);
  gaugeProgress.style.strokeDashoffset = circumference * (1 - percent / 100);
  $("speedValue").textContent = value >= 100 ? Math.round(value) : value.toFixed(1);
}

function format(value) {
  return Number.isFinite(value) ? (value >= 100 ? value.toFixed(0) : value.toFixed(1)) : "—";
}

function setStage(stage) {
  state.stage = stage;
  const download = stage === "download";
  const upload = stage === "upload";
  $("downloadStage").classList.toggle("active", download);
  $("uploadStage").classList.toggle("active", upload);
  $("downloadStage").classList.toggle("done", upload || stage === "finished");
  $("uploadStage").classList.toggle("done", stage === "finished");
  $("liveLabel").textContent = download ? "DOWNLOAD" : upload ? "UPLOAD" : stage === "finished" ? "DONE" : "READY";
}

function setDataProgress(percent, label) {
  const value = Math.max(0, Math.min(100, percent));
  $("dataMeterBar").style.width = `${value}%`;
  $("stageProgress").textContent = `${Math.round(value)}%`;
  $("dataMeterLabel").textContent = label;
}

function updateTimer() {
  if (!state.running) return;
  $("elapsed").textContent = `${((performance.now() - state.startedAt) / 1000).toFixed(1)}s`;
  requestAnimationFrame(updateTimer);
}

function getNetworkInfo() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  $("onlineState").textContent = navigator.onLine ? "Online" : "Offline";
  if (!connection) return;
  $("connectionType").textContent = connection.type || "Browser reported";
  $("downlinkEstimate").textContent = Number.isFinite(connection.downlink) ? `${connection.downlink} Mbps` : "—";
  $("effectiveType").textContent = connection.effectiveType || "—";
}

function readBandwidth(engine) {
  try {
    const results = engine.results;
    const down = results?.getDownloadBandwidth?.();
    const up = results?.getUploadBandwidth?.();
    const latency = results?.getUnloadedLatency?.();
    const jitter = results?.getUnloadedJitter?.();
    const downPoints = results?.getDownloadBandwidthPoints?.() || [];
    const upPoints = results?.getUploadBandwidthPoints?.() || [];
    return {
      download: Number.isFinite(down) ? down / 1e6 : NaN,
      upload: Number.isFinite(up) ? up / 1e6 : NaN,
      latency,
      jitter,
      downPoints,
      upPoints,
    };
  } catch {
    return { download: NaN, upload: NaN, latency: NaN, jitter: NaN, downPoints: [], upPoints: [] };
  }
}

function updateLiveResults(engine, eventType = "") {
  const data = readBandwidth(engine);
  state.downloadPoints = data.downPoints.length;
  state.uploadPoints = data.upPoints.length;

  if (Number.isFinite(data.download)) $("downloadResult").textContent = format(data.download);
  if (Number.isFinite(data.upload)) $("uploadResult").textContent = format(data.upload);
  if (Number.isFinite(data.latency)) $("pingResult").textContent = format(data.latency);
  if (Number.isFinite(data.jitter)) $("jitterResult").textContent = format(data.jitter);

  if (state.stage === "download") {
    const completed = Math.min(5, state.downloadPoints);
    const progress = Math.min(96, completed * 18 + 8);
    const current = data.downPoints.at(-1)?.bps ? data.downPoints.at(-1).bps / 1e6 : data.download;
    if (Number.isFinite(current)) setGauge(current);
    setDataProgress(progress, completed ? `${completed} transfer${completed === 1 ? "" : "s"} measured` : "Starting download measurement…");
  } else if (state.stage === "upload") {
    const completed = Math.min(5, state.uploadPoints);
    const progress = Math.min(96, completed * 18 + 8);
    const current = data.upPoints.at(-1)?.bps ? data.upPoints.at(-1).bps / 1e6 : data.upload;
    if (Number.isFinite(current)) setGauge(current);
    setDataProgress(progress, completed ? `${completed} transfer${completed === 1 ? "" : "s"} measured` : "Starting upload measurement…");
  }

  if (eventType === "latency") {
    if (Number.isFinite(data.latency)) $("pingResult").textContent = format(data.latency);
    if (Number.isFinite(data.jitter)) $("jitterResult").textContent = format(data.jitter);
  }
}

function makeEngine() {
  const engine = new SpeedTest({
    autoStart: false,
    measurements,
    measureDownloadLoadedLatency: false,
    measureUploadLoadedLatency: false,
    bandwidthFinishRequestDuration: 700,
    bandwidthMinRequestDuration: 10,
  });

  engine.onRunningChange = (running) => {
    state.running = running;
    $("startButton").hidden = running;
    $("stopButton").hidden = !running;
    $("retryButton").hidden = true;
    if (running) {
      $("connectionStatus").textContent = "Testing";
      $("startButton").disabled = true;
      state.startedAt = performance.now();
      requestAnimationFrame(updateTimer);
    } else if (state.stage !== "finished" && state.stage !== "error" && state.stage !== "stopped") {
      $("connectionStatus").textContent = "Ready";
    }
  };

  engine.onResultsChange = ({ type }) => {
    updateLiveResults(engine, type);

    if (type === "download" && state.stage !== "download") {
      setStage("download");
      $("testState").textContent = "Measuring download…";
    }
    if (type === "upload" && state.stage !== "upload") {
      setStage("upload");
      $("testState").textContent = "Measuring upload…";
      setDataProgress(4, "Upload measurement starting…");
    }
  };

  engine.onFinish = (results) => {
    const data = readBandwidth(engine);
    if (Number.isFinite(data.download)) $("downloadResult").textContent = format(data.download);
    if (Number.isFinite(data.upload)) $("uploadResult").textContent = format(data.upload);
    if (Number.isFinite(data.latency)) $("pingResult").textContent = format(data.latency);
    if (Number.isFinite(data.jitter)) $("jitterResult").textContent = format(data.jitter);

    const finalSpeed = Number.isFinite(data.upload) ? data.upload : data.download;
    if (Number.isFinite(finalSpeed)) setGauge(finalSpeed);
    setStage("finished");
    setDataProgress(100, "Measurement complete");
    $("testState").textContent = "Test complete";
    $("connectionStatus").textContent = "Complete";
    $("stopButton").hidden = true;
    $("retryButton").hidden = false;
    $("retryButton").textContent = "↻ Run Again";
    $("startButton").hidden = true;
    $("elapsed").textContent = `${(data.totalDurationMs ? data.totalDurationMs / 1000 : (performance.now() - state.startedAt) / 1000).toFixed(1)}s`;
  };

  engine.onError = (error) => {
    console.error("GLOBE speed test error:", error);
    state.running = false;
    state.stage = "error";
    $("connectionStatus").textContent = "Error";
    $("testState").textContent = "Measurement failed — tap Retry to try again.";
    $("stopButton").hidden = true;
    $("startButton").hidden = true;
    $("retryButton").hidden = false;
    $("retryButton").textContent = "↻ Retry Test";
  };

  return engine;
}

function resetUI() {
  setStage("idle");
  setGauge(0);
  setDataProgress(0, "Waiting for measurement");
  $("testState").textContent = "Ready for a test";
  $("connectionStatus").textContent = "Ready";
  $("downloadResult").textContent = "—";
  $("uploadResult").textContent = "—";
  $("pingResult").textContent = "—";
  $("jitterResult").textContent = "—";
  $("elapsed").textContent = "0.0s";
  $("startButton").hidden = false;
  $("startButton").disabled = false;
  $("startButton").textContent = "Start Test";
  $("stopButton").hidden = true;
  $("retryButton").hidden = true;
}

function startTest() {
  if (!navigator.onLine) {
    $("testState").textContent = "You are offline.";
    return;
  }
  if (!state.engine || state.engine.isFinished) state.engine = makeEngine();
  resetUI();
  state.startedAt = performance.now();
  state.stage = "download";
  setStage("download");
  $("testState").textContent = "Measuring download…";
  $("connectionStatus").textContent = "Testing";
  $("startButton").hidden = true;
  $("stopButton").hidden = false;
  $("retryButton").hidden = true;
  state.engine.play();
  requestAnimationFrame(updateTimer);
}

function stopTest() {
  if (!state.engine || !state.running) return;
  state.engine.pause();
  state.running = false;
  state.stage = "stopped";
  $("connectionStatus").textContent = "Stopped";
  $("testState").textContent = "Test stopped.";
  $("stopButton").hidden = true;
  $("startButton").hidden = true;
  $("retryButton").hidden = false;
  $("retryButton").textContent = "↻ Retry Test";
}

$("startButton").addEventListener("click", startTest);
$("stopButton").addEventListener("click", stopTest);
$("retryButton").addEventListener("click", () => {
  if (state.engine && !state.engine.isFinished) state.engine.pause();
  state.engine = null;
  startTest();
});

window.addEventListener("online", getNetworkInfo);
window.addEventListener("offline", () => {
  getNetworkInfo();
  if (state.running) stopTest();
});

resetUI();
getNetworkInfo();
