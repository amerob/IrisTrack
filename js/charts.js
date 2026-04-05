/**
 * charts.js — Chart.js 4.4.4 timelines + Canvas 2D lid profile drawing.
 * Assumes Chart is available as a global (UMD via CDN in index.html).
 */

import { CHART_MAX_POINTS, EAR_NORMAL_MIN, EAR_NORMAL_MAX } from './config.js';

// ─── Module state ────────────────────────────────────────────────────────────
let earChart  = null;
let asymChart = null;

// Ring canvas contexts (cached after first draw)
const _ringCtx = {};

// ─── Chart.js global defaults ────────────────────────────────────────────────
function applyGlobalDefaults() {
  Chart.defaults.color          = '#64748b';
  Chart.defaults.font.family    = "'Inter', sans-serif";
  Chart.defaults.font.size      = 11;
  Chart.defaults.animation      = false; // disable for real-time performance
}

// ─── EAR Timeline ────────────────────────────────────────────────────────────
export function initCharts() {
  applyGlobalDefaults();

  const earCanvas  = document.getElementById('chart-ear');
  const asymCanvas = document.getElementById('chart-asym');
  const earCtx  = earCanvas.getContext('2d');
  const asymCtx = asymCanvas.getContext('2d');

  const baseDataset = {
    borderWidth: 1.5,
    pointRadius: 0,
    tension: 0.35,
    fill: true,
  };

  earChart = new Chart(earCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          ...baseDataset,
          label: 'Left EAR',
          data: [],
          borderColor: 'rgba(0,229,255,0.9)',
          backgroundColor: 'rgba(0,229,255,0.07)',
        },
        {
          ...baseDataset,
          label: 'Right EAR',
          data: [],
          borderColor: 'rgba(105,255,125,0.9)',
          backgroundColor: 'rgba(105,255,125,0.05)',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          display: false,
        },
        y: {
          min: 0,
          suggestedMax: 0.45,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { stepSize: 0.1 },
        },
      },
      plugins: {
        legend: { display: true, position: 'top', labels: { boxWidth: 10, padding: 10 } },
        annotation: { /* normal range band drawn manually below */ },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(3)}`,
          },
        },
      },
    },
  });

  asymChart = new Chart(asymCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          ...baseDataset,
          label: 'Asymmetry %',
          data: [],
          borderColor: 'rgba(255,107,107,0.9)',
          backgroundColor: 'rgba(255,107,107,0.07)',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { display: false },
        y: {
          min: 0,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { callback: v => v + '%' },
        },
      },
      plugins: {
        legend: { display: true, position: 'top', labels: { boxWidth: 10, padding: 10 } },
        tooltip: {
          callbacks: {
            label: ctx => `Asymmetry: ${ctx.parsed.y.toFixed(1)}%`,
          },
        },
      },
    },
  });
}

/**
 * updateCharts — Push one new data point to both charts.
 * Trims to CHART_MAX_POINTS to keep the rolling window tight.
 *
 * @param {object} m — measurements object from buildMeasurements()
 */
export function updateCharts(m) {
  if (!earChart || !asymChart) return;

  const label = new Date().toLocaleTimeString('en-US', { hour12: false });

  function push(chart, datasets) {
    chart.data.labels.push(label);
    datasets.forEach(({ idx, val }) => chart.data.datasets[idx].data.push(val));
    if (chart.data.labels.length > CHART_MAX_POINTS) {
      chart.data.labels.shift();
      chart.data.datasets.forEach(ds => ds.data.shift());
    }
    chart.update('none');
  }

  push(earChart,  [{ idx: 0, val: m.earLeft }, { idx: 1, val: m.earRight }]);
  push(asymChart, [{ idx: 0, val: m.asymmetry }]);
}

// ─── Circular ring canvases ──────────────────────────────────────────────────
/**
 * drawRing — Draw a circular progress ring showing an EAR value.
 *
 * @param {string} id     — canvas element id ('ring-left' | 'ring-right')
 * @param {number} ear    — EAR value 0–0.5
 * @param {boolean} isInfected
 */
export function drawRing(id, ear, isInfected = false) {
  const canvas = document.getElementById(id);
  if (!canvas) return;

  if (!_ringCtx[id]) _ringCtx[id] = canvas.getContext('2d');
  const ctx = _ringCtx[id];
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r  = (Math.min(w, h) / 2) - 8;

  ctx.clearRect(0, 0, w, h);

  // Background track
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth   = 6;
  ctx.stroke();

  // Progress arc (0 = top, clockwise)
  const pct   = Math.min(ear / 0.40, 1);       // 0.40 = top of scale
  const start = -Math.PI / 2;
  const end   = start + pct * Math.PI * 2;

  const color = isInfected
    ? (ear < EAR_NORMAL_MIN ? 'rgba(255,107,107,0.9)' : 'rgba(255,200,0,0.9)')
    : 'rgba(0,229,255,0.9)';

  ctx.beginPath();
  ctx.arc(cx, cy, r, start, end);
  ctx.strokeStyle = color;
  ctx.lineWidth   = 6;
  ctx.lineCap     = 'round';
  ctx.stroke();
}

// ─── Lid Profile Canvas ──────────────────────────────────────────────────────
/**
 * drawLidProfile — Draw 7-point lid shape on a 2D canvas.
 *
 * @param {string} canvasId   — 'lid-left' | 'lid-right'
 * @param {number[]} profile  — 7 normalized vertical gaps
 * @param {boolean} isInfected
 */
export function drawLidProfile(canvasId, profile, isInfected = false) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const w   = canvas.clientWidth || canvas.width;
  const h   = canvas.height || 90;
  canvas.width = w;

  ctx.clearRect(0, 0, w, h);

  const n       = profile.length;
  const stepX   = w / (n + 1);
  const midY    = h / 2;
  const scale   = (h * 0.4) / 0.05;   // 0.05 normalized units → 40% of canvas height

  const accent = isInfected ? '#ff6b6b' : '#00e5ff';

  // Grid line
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (profile.every(v => v === 0)) return;

  // Upper lid path (top of gap)
  const upperPts = profile.map((v, i) => ({ x: (i + 1) * stepX, y: midY - (v / 2) * scale }));
  const lowerPts = profile.map((v, i) => ({ x: (i + 1) * stepX, y: midY + (v / 2) * scale }));

  function drawSmoothPath(pts, color) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1].x + pts[i].x) / 2;
      const my = (pts[i - 1].y + pts[i].y) / 2;
      ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.stroke();
  }

  // Fill between upper and lower
  ctx.beginPath();
  ctx.moveTo(upperPts[0].x, upperPts[0].y);
  upperPts.forEach(p => ctx.lineTo(p.x, p.y));
  lowerPts.slice().reverse().forEach(p => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.fillStyle = isInfected ? 'rgba(255,107,107,0.08)' : 'rgba(0,229,255,0.07)';
  ctx.fill();

  drawSmoothPath(upperPts, accent);
  drawSmoothPath(lowerPts, accent);

  // Dots at measurement points
  [...upperPts, ...lowerPts].forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
  });
}
