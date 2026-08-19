const $ = (id) => document.getElementById(id);
const progressCircle = $("gaugeProgress");
const circumference = 2 * Math.PI * 112;
progressCircle.style.strokeDasharray = circumference;
progressCircle.style.strokeDashoffset = circumference;

const state = { running: false, metric: "download", download: null, upload: null, ping: null, jitter: null };

function setProgress(percent) {
  const clamped = Math.max(0, Math.min(100, percent));
  progressCircle.style.strokeDashoffset = circumference * (1 - clamped / 100);
  $("progressBar").style.width = `${clamped}%`;
}

function setMetric(value, unit = "Mbps") {
  $("speedValue").textContent = Number.isFinite(value) ? value.toFixed(value >= 100 ? 0 : 1) : "0.0";
  $("speedUnit").textContent = unit;
}

function format(value) {
  return Number.isFinite(value) ? (value >= 100 ? value.toFixed(0) : value.toFixed(1)) : "—";
}

function getNetworkInfo() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  $("onlineState").textContent = navigator.onLine ? "Online" : "Offline";
  if (!connection) return;
  $("connectionType").textContent = connection.type || "Browser reported";
  $("downlinkEstimate").textContent = Number.isFinite(connection.downlink) ? `${connection.downlink} Mbps` : "—";
  $("effectiveType").textContent = connection.effectiveType || "—";
}

function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}

async function measureLatency() {
  const endpoint = "https://www.cloudflare.com/cdn-cgi/trace";
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      await fetch(`${endpoint}?cacheBust=${crypto.randomUUID()}`, {
        cache: "no-store",
        mode: "cors",
        signal: controller.signal,
      });
      samples.push(performance.now() - start);
    } finally {
      clearTimeout(timer);
    }
  }
  if (!samples.length) throw new Error("Latency endpoint unavailable");
  const jitterSamples = samples.slice(1).map((n, i) => Math.abs(n - samples[i]));
  return { avg: average(samples), jitter: average(jitterSamples) };
}

async function measureDownload() {
  const sizes = [5000000, 10000000, 20000000];
  const results = [];
  for (let i = 0; i < sizes.length; i++) {
    const start = performance.now();
    const response = await fetch(`https://speed.cloudflare.com/__down?bytes=${sizes[i]}&cacheBust=${crypto.randomUUID()}`, {
      cache: "no-store",
    });
    if (!response.ok || !response.body) throw new Error("Download endpoint unavailable");
    const reader = response.body.getReader();
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      const elapsed = (performance.now() - start) / 1000;
      if (elapsed > 0) setMetric((bytes * 8) / elapsed / 1e6, "Mbps");
      setProgress(10 + i * 17 + Math.min(17, (elapsed / 8) * 17));
    }
    const elapsed = (performance.now() - start) / 1000;
    if (elapsed > 0) results.push((bytes * 8) / elapsed / 1e6);
  }
  if (!results.length) throw new Error("Download measurement failed");
  return average(results.slice(-2));
}

async function measureUpload() {
  const endpoint = "https://httpbin.org/anything";
  const sizes = [750000, 1500000, 2500000];
  const results = [];
  for (let i = 0; i < sizes.length; i++) {
    const body = new Uint8Array(sizes[i]);
    crypto.getRandomValues(body.subarray(0, Math.min(body.length, 65536)));
    const start = performance.now();
    const response = await fetch(`${endpoint}?cacheBust=${crypto.randomUUID()}`, {
      method: "POST",
      body,
      cache: "no-store",
      headers: { "Content-Type": "application/octet-stream" },
    });
    if (!response.ok) throw new Error("Upload endpoint unavailable");
    await response.arrayBuffer();
    const elapsed = (performance.now() - start) / 1000;
    if (elapsed > 0) results.push((body.byteLength * 8) / elapsed / 1e6);
    setProgress(62 + i * 12);
    if (results.length) setMetric(results.at(-1), "Mbps");
  }
  if (!results.length) throw new Error("Upload measurement failed");
  return average(results.slice(-2));
}

async function runTest() {
  if (state.running || !navigator.onLine) return;
  state.running = true;
  $("startButton").disabled = true;
  $("startButton").textContent = "Testing…";
  $("connectionStatus").textContent = "Testing";
  $("testState").textContent = "Measuring latency…";
  setProgress(3);
  const started = performance.now();

  try {
    const latency = await measureLatency();
    state.ping = latency.avg;
    state.jitter = latency.jitter;
    $("pingResult").textContent = format(state.ping);
    $("jitterResult").textContent = format(state.jitter);
    setMetric(state.ping, "ms");

    $("testState").textContent = "Measuring download…";
    state.download = await measureDownload();
    $("downloadResult").textContent = format(state.download);

    $("testState").textContent = "Measuring upload…";
    state.upload = await measureUpload();
    $("uploadResult").textContent = format(state.upload);

    setMetric(state.download, "Mbps");
    setProgress(100);
    $("testState").textContent = "Test complete";
    $("connectionStatus").textContent = "Complete";
  } catch (error) {
    console.error("GLOBE test failed:", error);
    $("testState").textContent = "Test failed — retry or check your connection.";
    $("connectionStatus").textContent = "Error";
    setProgress(0);
  } finally {
    state.running = false;
    $("startButton").disabled = false;
    $("startButton").textContent = "Run Again";
    $("elapsed").textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`;
  }
}

document.querySelectorAll(".metric-tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".metric-tab").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    state.metric = button.dataset.metric;
    const values = {
      download: [state.download, "Mbps"],
      upload: [state.upload, "Mbps"],
      ping: [state.ping, "ms"],
    };
    setMetric(values[state.metric][0], values[state.metric][1]);
  });
});

$("startButton").addEventListener("click", runTest);
window.addEventListener("online", getNetworkInfo);
window.addEventListener("offline", getNetworkInfo);
getNetworkInfo();
