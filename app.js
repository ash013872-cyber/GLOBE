const $ = (id) => document.getElementById(id);
const progressCircle = $("gaugeProgress");
const circumference = 2 * Math.PI * 112;
progressCircle.style.strokeDasharray = circumference;
progressCircle.style.strokeDashoffset = circumference;

const state = {
  running: false,
  metric: "download",
  download: null,
  upload: null,
  ping: null,
  jitter: null,
};

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
  $("onlineState").className = navigator.onLine ? "online" : "offline";
  if (!connection) return;
  $("connectionType").textContent = connection.type || "Browser reported";
  $("downlinkEstimate").textContent = Number.isFinite(connection.downlink) ? `${connection.downlink} Mbps` : "—";
  $("effectiveType").textContent = connection.effectiveType || "—";
}

function average(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function measurePing() {
  const samples = [];
  const endpoint = "https://www.cloudflare.com/cdn-cgi/trace";
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    try {
      await fetch(`${endpoint}?t=${Date.now()}-${i}`, { cache: "no-store", mode: "cors" });
      samples.push(performance.now() - start);
    } catch {
      // CORS/network failures are handled by the caller.
    }
  }
  if (!samples.length) throw new Error("Ping endpoint unavailable");
  const avg = average(samples);
  const jitter = average(samples.map((n, i) => i ? Math.abs(n - samples[i - 1]) : 0).slice(1));
  return { avg, jitter };
}

async function measureDownload() {
  // Public cache-busted files. Using several object sizes avoids making the UI
  // look fast because of a tiny response while keeping the browser responsive.
  const urls = [
    "https://speed.cloudflare.com/__down?bytes=5000000",
    "https://speed.cloudflare.com/__down?bytes=10000000",
    "https://speed.cloudflare.com/__down?bytes=20000000",
  ];
  const results = [];
  for (let i = 0; i < urls.length; i++) {
    const start = performance.now();
    const response = await fetch(`${urls[i]}&cacheBust=${crypto.randomUUID()}`, { cache: "no-store" });
    if (!response.ok || !response.body) throw new Error("Download endpoint unavailable");
    const reader = response.body.getReader();
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      const elapsed = (performance.now() - start) / 1000;
      const mbps = elapsed > 0 ? (bytes * 8) / elapsed / 1e6 : 0;
      setMetric(mbps, "Mbps");
      setProgress(10 + (i * 25) + Math.min(25, elapsed * 2));
    }
    const elapsed = (performance.now() - start) / 1000;
    results.push((bytes * 8) / elapsed / 1e6);
  }
  return average(results.slice(-2));
}

async function measureUpload() {
  // Upload tests are sent to an endpoint that accepts POST bodies. Three runs
  // reduce one-off Wi-Fi spikes while limiting total data usage.
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
    const mbps = (body.byteLength * 8) / elapsed / 1e6;
    results.push(mbps);
    setMetric(mbps, "Mbps");
    setProgress(60 + i * 12);
  }
  return average(results.slice(-2));
}

async function runTest() {
  if (state.running) return;
  state.running = true;
  $("startButton").disabled = true;
  $("startButton").textContent = "Testing…";
  $("connectionStatus").textContent = "Testing";
  $("testState").textContent = "Measuring latency…";
  setProgress(3);
  const started = performance.now();

  try {
    const ping = await measurePing();
    state.ping = ping.avg;
    state.jitter = ping.jitter;
    $("pingResult").textContent = format(state.ping);
    $("jitterResult").textContent = format(state.jitter);
    setMetric(state.ping, "ms");
    $("testState").textContent = "Measuring download…";
    setProgress(12);

    state.download = await measureDownload();
    $("downloadResult").textContent = format(state.download);
    setMetric(state.download, "Mbps");
    $("testState").textContent = "Measuring upload…";
    setProgress(62);

    state.upload = await measureUpload();
    $("uploadResult").textContent = format(state.upload);
    setMetric(state.upload, "Mbps");
    setProgress(100);
    $("testState").textContent = "Test complete";
    $("connectionStatus").textContent = "Complete";
  } catch (error) {
    console.error(error);
    $("testState").textContent = "Test could not complete — check your connection or try again.";
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
    const values = { download: [state.download, "Mbps"], upload: [state.upload, "Mbps"], ping: [state.ping, "ms"] };
    setMetric(values[state.metric][0], values[state.metric][1]);
  });
});

$("startButton").addEventListener("click", runTest);
window.addEventListener("online", getNetworkInfo);
window.addEventListener("offline", getNetworkInfo);
getNetworkInfo();
