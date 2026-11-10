
"use strict";

const $ = id => document.getElementById(id);

const olr = $("olr");
const moduleSelect = $("module");
const fpsSelect = $("fpsTarget");
const durationSelect = $("duration");

const canvas = $("visualizer");
const ctx = canvas.getContext("2d", { alpha: false });
const chart = $("chart");
const chartCtx = chart.getContext("2d");

const MAX_PARTICLES = 1400;
const MAX_DPR = 1.5;
const MAX_CPU_OPS_PER_FRAME = 10000;

let running = false;
let animationId = null;
let particles = [];
let history = Array(60).fill(0);
let sessionStart = 0;
let elapsed = 0;
let frameCount = 0;
let fps = 0;
let lastFrame = 0;
let lastFpsUpdate = 0;
let lastChartUpdate = 0;
let cpuOperations = 0;
let cpuScore = 0;
let gpuScore = 0;
let checksum = 0;
let reportText = "No benchmark completed yet.";

// --------------------------------
// DEVICE INFORMATION
// --------------------------------

function detectDevice() {
  $("device").textContent =
    /iPad|iPhone|Android/i.test(navigator.userAgent)
      ? "MOBILE"
      : "DESKTOP / LAPTOP";

  $("screen").textContent =
    `${screen.width} × ${screen.height}`;

  $("cores").textContent =
    navigator.hardwareConcurrency
      ? `${navigator.hardwareConcurrency} THREADS`
      : "UNAVAILABLE";

  const memory = performance.memory;

  $("memory").textContent = memory
    ? `${(memory.usedJSHeapSize / 1048576).toFixed(0)} MB HEAP`
    : "UNAVAILABLE";

  $("network").textContent = navigator.onLine
    ? "ONLINE"
    : "OFFLINE";

  const connection = navigator.connection;

  $("connection").textContent =
    connection?.effectiveType || "UNKNOWN";

  const testCanvas = document.createElement("canvas");

  $("webgl").textContent =
    testCanvas.getContext("webgl") ||
    testCanvas.getContext("webgl2")
      ? "SUPPORTED"
      : "UNAVAILABLE";
}

window.addEventListener("online", () => {
  $("network").textContent = "ONLINE";
});

window.addEventListener("offline", () => {
  $("network").textContent = "OFFLINE";
});

// --------------------------------
// CONFIGURATION
// --------------------------------

function quality() {
  return Math.min(24, Math.ceil(Number(olr.value) / 125));
}

function particleTarget() {
  return Math.min(
    MAX_PARTICLES,
    Math.round(80 + Number(olr.value) * 0.35)
  );
}

function updateConfig() {
  $("olrValue").textContent =
    String(olr.value).padStart(3, "0");

  $("particleCount").textContent =
    particleTarget().toLocaleString();

  $("qualityLevel").textContent =
    `${String(quality()).padStart(2, "0")} / 24`;

  if (running) {
    setParticleCount(particleTarget());
  }
}

olr.addEventListener("input", updateConfig);

moduleSelect.addEventListener("change", () => {
  if (running) stopTest("MODULE CHANGED");
});

fpsSelect.addEventListener("change", () => {
  if (running) stopTest("FPS SETTING CHANGED");
});

durationSelect.addEventListener("change", () => {
  if (running) stopTest("DURATION CHANGED");
});

// --------------------------------
// CANVAS
// --------------------------------

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, MAX_DPR);

  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  drawChart();
}

function randomParticle() {
  return {
    x: Math.random() * canvas.clientWidth,
    y: Math.random() * canvas.clientHeight,
    vx: (Math.random() - 0.5) * 1.3,
    vy: (Math.random() - 0.5) * 1.3,
    size: 0.6 + Math.random() * 1.8,
    alpha: 0.3 + Math.random() * 0.6
  };
}

function setParticleCount(count) {
  count = Math.max(0, Math.min(MAX_PARTICLES, count));

  while (particles.length < count) {
    particles.push(randomParticle());
  }

  particles.length = count;

  $("activeParticles").textContent =
    count.toLocaleString();
}

function updateParticles(delta) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const multiplier = Math.min(delta / 16.67, 2);

  for (const p of particles) {
    p.x += p.vx * multiplier;
    p.y += p.vy * multiplier;

    if (p.x < 0 || p.x > w) p.vx *= -1;
    if (p.y < 0 || p.y > h) p.vy *= -1;

    p.x = Math.max(0, Math.min(w, p.x));
    p.y = Math.max(0, Math.min(h, p.y));
  }
}

function drawGraphics(timestamp) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  ctx.fillStyle = "#080a10";
  ctx.fillRect(0, 0, w, h);

  // Background grid
  ctx.strokeStyle = "rgba(255,255,255,.035)";
  ctx.lineWidth = 1;

  for (let x = 0; x < w; x += 35) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  for (let y = 0; y < h; y += 35) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Particles
  for (const p of particles) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,48,60,${p.alpha})`;
    ctx.fill();
  }

  // Bounded connection sampling
  const step = Math.max(1, Math.ceil(particles.length / 100));
  const sample = [];

  for (let i = 0; i < particles.length; i += step) {
    sample.push(particles[i]);
  }

  ctx.lineWidth = 0.6;

  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const a = sample[i];
      const b = sample[j];

      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d2 = dx * dx + dy * dy;

      if (d2 < 3600) {
        const alpha = (1 - Math.sqrt(d2) / 60) * 0.17;

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(255,48,60,${alpha})`;
        ctx.stroke();
      }
    }
  }

  // Center reticle
  const cx = w / 2;
  const cy = h / 2;

  ctx.strokeStyle =
    `rgba(255,48,60,${0.3 + Math.sin(timestamp * 0.002) * 0.1})`;

  ctx.beginPath();
  ctx.arc(cx, cy, 25, 0, Math.PI * 2);
  ctx.moveTo(cx - 38, cy);
  ctx.lineTo(cx - 15, cy);
  ctx.moveTo(cx + 15, cy);
  ctx.lineTo(cx + 38, cy);
  ctx.moveTo(cx, cy - 38);
  ctx.lineTo(cx, cy - 15);
  ctx.moveTo(cx, cy + 15);
  ctx.lineTo(cx, cy + 38);
  ctx.stroke();
}

// --------------------------------
// CPU BENCHMARK
// --------------------------------

function runCpuSlice() {
  const start = performance.now();

  const operations = Math.min(
    MAX_CPU_OPS_PER_FRAME,
    200 + Math.floor(Number(olr.value) * 3)
  );

  let value = checksum || 1;

  for (let i = 0; i < operations; i++) {
    value = (value * 1664525 + 1013904223) >>> 0;
    value ^= value >>> 13;
  }

  checksum = value;
  cpuOperations += operations;

  const spent = performance.now() - start;

  if (spent > 10) {
    console.warn("CPU benchmark slice exceeded time budget.");
  }
}

// --------------------------------
// BENCHMARK ENGINE
// --------------------------------

function startTest() {
  if (running) return;

  running = true;

  particles = [];
  history.fill(0);

  cpuOperations = 0;
  checksum = 1;
  cpuScore = 0;
  gpuScore = 0;
  fps = 0;
  frameCount = 0;

  elapsed = 0;
  sessionStart = performance.now();
  lastFrame = 0;
  lastFpsUpdate = sessionStart;
  lastChartUpdate = sessionStart;

  setParticleCount(particleTarget());

  $("startBtn").disabled = true;
  $("stopBtn").disabled = false;

  $("statusText").textContent = "TEST RUNNING";
  $("statusDot").style.background = "#53dba0";
  $("testState").textContent = "RUNNING";
  $("testState").style.color = "#53dba0";

  $("canvasOverlay").style.display = "none";
  $("renderState").textContent = "ENGINE ACTIVE";

  $("report").textContent = "Benchmark in progress...";

  animationId = requestAnimationFrame(render);
}

function render(timestamp) {
  if (!running) return;

  const target = Number(fpsSelect.value);
  const interval = 1000 / target;

  if (lastFrame && timestamp - lastFrame < interval) {
    animationId = requestAnimationFrame(render);
    return;
  }

  const delta = lastFrame
    ? Math.min(timestamp - lastFrame, 50)
    : 16.67;

  lastFrame = timestamp;
  frameCount++;

  const selected = moduleSelect.value;

  if (selected === "cpu" || selected === "combined") {
    runCpuSlice();
  }

  if (selected === "gpu" || selected === "combined") {
    updateParticles(delta);
    drawGraphics(timestamp);
  } else {
    ctx.fillStyle = "#080a10";
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  }

  if (timestamp - lastFpsUpdate >= 1000) {
    fps = Math.round(
      frameCount * 1000 / (timestamp - lastFpsUpdate)
    );

    $("fpsValue").textContent = fps;
    $("frameTime").textContent =
      fps ? (1000 / fps).toFixed(2) : "--";

    gpuScore = Math.round(fps * (selected === "combined" ? 1 : 1.2));

    cpuScore = Math.round(cpuOperations / Math.max(1, elapsed / 1000));

    $("cpuScore").textContent =
      selected === "gpu" ? "N/A" : cpuScore.toLocaleString();

    $("gpuScore").textContent =
      selected === "cpu" ? "N/A" : gpuScore.toLocaleString();

    frameCount = 0;
    lastFpsUpdate = timestamp;
  }

  elapsed = timestamp - sessionStart;

  const seconds = elapsed / 1000;
  const total = Number(durationSelect.value);
  const progress = Math.min(100, seconds / total * 100);

  $("sessionTime").textContent = formatTime(seconds);
  $("progressText").textContent = `${Math.round(progress)}%`;
  $("progressBar").style.width = `${progress}%`;

  if (timestamp - lastChartUpdate >= 1000) {
    history.push(fps);
    history.shift();
    drawChart();
    lastChartUpdate = timestamp;
  }

  if (seconds >= total) {
    stopTest("COMPLETED");
    return;
  }

  animationId = requestAnimationFrame(render);
}

// --------------------------------
// STOP / REPORT
// --------------------------------

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);

  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function stopTest(reason = "STOPPED") {
  if (!running) return;

  running = false;

  if (animationId !== null) {
    cancelAnimationFrame(animationId);
  }

  animationId = null;

  const seconds = elapsed / 1000;
  const selected = moduleSelect.value;

  particles = [];

  $("activeParticles").textContent = "0";
  $("startBtn").disabled = false;
  $("stopBtn").disabled = true;

  $("statusText").textContent = "SYSTEM STANDBY";
  $("statusDot").style.background = "#53dba0";

  $("testState").textContent = "STANDBY";
  $("testState").style.color = "";

  $("renderState").textContent = "ENGINE OFFLINE";

  $("canvasOverlay").style.display = "flex";
  $("canvasOverlay").innerHTML = `
    <div class="crosshair">+</div>
    <strong>SESSION ${reason}</strong>
    <small>RENDERING STOPPED</small>
  `;

  reportText = [
    "OVER//LOADER — STRESS LAB REPORT",
    "--------------------------------",
    `Result: ${reason}`,
    `Module: ${selected.toUpperCase()}`,
    `OLR: ${olr.value}`,
    `FPS target: ${fpsSelect.value}`,
    `Duration: ${seconds.toFixed(2)} seconds`,
    `Last measured FPS: ${fps}`,
    `CPU operations: ${cpuOperations.toLocaleString()}`,
    `CPU score: ${cpuScore}`,
    `GPU score: ${gpuScore}`,
    `Device: ${$("device").textContent}`,
    `Logical cores: ${$("cores").textContent}`,
    `Time: ${new Date().toLocaleString()}`
  ].join("\n");

  $("report").textContent = reportText;

  $("progressBar").style.width =
    reason === "COMPLETED" ? "100%" : $("progressBar").style.width;
}

// --------------------------------
// PERFORMANCE CHART
// --------------------------------

function drawChart() {
  const width = chart.clientWidth;
  const height = chart.clientHeight;

  if (!width || !height) return;

  const dpr = Math.min(devicePixelRatio || 1, MAX_DPR);

  chart.width = Math.floor(width * dpr);
  chart.height = Math.floor(height * dpr);

  chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  chartCtx.clearRect(0, 0, width, height);

  chartCtx.strokeStyle = "rgba(255,255,255,.07)";

  for (let i = 0; i < 4; i++) {
    const y = i * height / 3;

    chartCtx.beginPath();
    chartCtx.moveTo(0, y);
    chartCtx.lineTo(width, y);
    chartCtx.stroke();
  }

  const max = Math.max(120, ...history);

  chartCtx.beginPath();

  history.forEach((value, index) => {
    const x = index / (history.length - 1) * width;
    const y = height - value / max * height;

    if (index === 0) chartCtx.moveTo(x, y);
    else chartCtx.lineTo(x, y);
  });

  chartCtx.strokeStyle = "#ff303c";
  chartCtx.lineWidth = 2;
  chartCtx.stroke();
}

// --------------------------------
// EXPORT
// --------------------------------

$("exportBtn").addEventListener("click", () => {
  const blob = new Blob([reportText], {
    type: "text/plain"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "over-loader-report.txt";
  link.click();

  URL.revokeObjectURL(url);
});

// --------------------------------
// INITIALIZATION
// --------------------------------

$("startBtn").addEventListener("click", startTest);
$("stopBtn").addEventListener("click", () => stopTest("STOPPED"));

document.addEventListener("visibilitychange", () => {
  if (document.hidden && running) {
    stopTest("PAUSED - TAB HIDDEN");
  }
});

window.addEventListener("resize", resizeCanvas);

detectDevice();
resizeCanvas();
updateConfig();
drawChart();
