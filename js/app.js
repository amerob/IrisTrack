/**
 * app.js — Main orchestration: camera, settings, automated Iris flow,
 * snapshot gallery, modal, and UI wiring.
 */

import * as Tracker  from './facetracker.js';
import * as Charts   from './charts.js';
import * as Storage  from './storage.js';
import { speak, setVoiceCallbacks, setElevenErrorCallback } from './voice.js';
import { analyzeFrame }             from './ai.js';
import { createConversation }       from './conversation.js';
import {
  LEFT_LID_PROFILE, RIGHT_LID_PROFILE,
  GREETING_FRAME, ANALYSIS_FRAME,
} from './config.js';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const videoEl     = document.getElementById('video');
const overlayEl   = document.getElementById('overlay');
const btnStart    = document.getElementById('btn-start');
const btnStop     = document.getElementById('btn-stop');
const btnSnapshot = document.getElementById('btn-snapshot');
const btnSettings = document.getElementById('btn-settings');
const btnAnalyze  = document.getElementById('btn-analyze');
const btnExport   = document.getElementById('btn-export');
const btnClearHistory = document.getElementById('btn-clear-history');

// Metrics
const earLeftEl   = document.getElementById('ear-left-val');
const earRightEl  = document.getElementById('ear-right-val');
const asymEl      = document.getElementById('asym-val');
const relOpenEl   = document.getElementById('rel-open-val');
const pfhLeftEl   = document.getElementById('pfh-left-val');
const pfhRightEl  = document.getElementById('pfh-right-val');
const blinkLEl    = document.getElementById('blink-left-val');
const blinkREl    = document.getElementById('blink-right-val');
const camDot      = document.getElementById('cam-dot');
const camLabel    = document.getElementById('cam-label');

// Header / session
const recoveryScoreEl  = document.getElementById('recovery-score');
const sessionTimerEl   = document.getElementById('session-timer');
const sessionStatusEl  = document.getElementById('session-status');
const metricsLiveBadge = document.getElementById('metrics-live-badge');
const fpsBadgeEl       = document.getElementById('fps-badge');

// Progress / status elements
const asymBarEl        = document.getElementById('asym-bar');
const opennessBarEl    = document.getElementById('openness-bar');
const recoveryBadgeEl  = document.getElementById('recovery-badge');
const infectionBadgeEl = document.getElementById('infection-badge');
const earLeftCard      = document.getElementById('ear-left-card');
const earRightCard     = document.getElementById('ear-right-card');

// AI panel
const aiContent   = document.getElementById('ai-content');
const aiTimestamp = document.getElementById('ai-timestamp');

// Iris voice indicator
const irisWaves   = document.getElementById('iris-waves');
const irisStatus  = document.getElementById('iris-status');

// Settings
const settingsPanel   = document.getElementById('settings-panel');
const claudeKeyEl     = document.getElementById('claude-key');
const elevenKeyEl     = document.getElementById('eleven-key');
const elevenVoiceEl   = document.getElementById('eleven-voice');
const snapNoteEl      = document.getElementById('snap-note');
const settingsSave    = document.getElementById('settings-save');
const settingsCancel  = document.getElementById('settings-cancel');
const settingsClose   = document.getElementById('settings-close');
const voiceEngToggle  = document.getElementById('voice-engine-toggle');
const infectedToggle  = document.getElementById('infected-eye-toggle');

// Gallery & modal
const galleryGrid   = document.getElementById('gallery-grid');
const galleryEmpty  = document.getElementById('gallery-empty');
const snapModal     = document.getElementById('snap-modal');
const modalClose    = document.getElementById('modal-close');
const modalDelete   = document.getElementById('modal-delete');
const modalImg      = document.getElementById('modal-img');
const modalMetrics  = document.getElementById('modal-metrics');
const modalNotes    = document.getElementById('modal-notes');
const modalTitle    = document.getElementById('modal-title');

// Lid tags
const leftLidTag  = document.getElementById('left-lid-tag');
const rightLidTag = document.getElementById('right-lid-tag');

// ─── App state ────────────────────────────────────────────────────────────────
let stream           = null;
let frameCount       = 0;
let autoFlowDone     = false;
let lastMeasurements = null;
let lastAiAnalysis   = '';
let currentModalId   = null;
let modelLoading     = false;
let sessionStart     = null;
let timerInterval    = null;
let conversation     = null;

// ─── Boot ─────────────────────────────────────────────────────────────────────
(async function boot() {
  loadSettingsIntoUI();
  Charts.initCharts();
  renderGallery();
  wireEvents();
  updateLidTags();
  initConversation();

  setVoiceCallbacks(
    () => { irisWaves.classList.add('speaking'); irisStatus.textContent = 'Iris · speaking'; },
    () => { irisWaves.classList.remove('speaking'); irisStatus.textContent = 'Iris · ready'; }
  );

  setElevenErrorCallback(msg => {
    // Flash the Iris bar orange so user knows ElevenLabs failed
    if (irisStatus) {
      irisStatus.textContent = '⚠ ' + msg;
      irisStatus.style.color = 'var(--warn)';
      setTimeout(() => {
        irisStatus.textContent = 'Iris · ready';
        irisStatus.style.color = '';
      }, 6000);
    }
  });
})();

// ─── Two-way conversation ─────────────────────────────────────────────────────
function initConversation() {
  conversation = createConversation();

  const btnMic       = document.getElementById('btn-mic');
  const transcriptEl = document.getElementById('mic-transcript');

  if (!conversation) {
    // SpeechRecognition not available — show a tooltip
    if (btnMic) {
      btnMic.disabled = true;
      btnMic.title    = 'Voice input requires Chrome or Edge';
    }
    return;
  }

  // Enable mic immediately — user can ask questions any time
  if (btnMic) btnMic.disabled = false;

  conversation.setContextProvider(() => ({
    measurements: lastMeasurements,
    lastAnalysis: lastAiAnalysis,
  }));

  conversation.setStateCallback(async (state, detail) => {
    if (!btnMic) return;

    switch (state) {

      case 'listening':
        btnMic.textContent = '🔴 Listening…';
        btnMic.classList.add('listening');
        if (transcriptEl) {
          transcriptEl.textContent = 'Listening…';
          transcriptEl.style.display = 'block';
        }
        break;

      case 'interim':
        if (transcriptEl) transcriptEl.textContent = detail || 'Listening…';
        break;

      case 'processing':
        btnMic.textContent = '⏳ Thinking…';
        btnMic.classList.remove('listening');
        if (transcriptEl) transcriptEl.textContent = `You: "${detail}"`;
        break;

      case 'answering': {
        // detail = { question, answer }
        const { question, answer } = detail;
        btnMic.textContent = '🎙 Ask Iris';

        // Show Q&A in transcript area
        if (transcriptEl) {
          transcriptEl.innerHTML =
            `<strong style="color:var(--text-dim)">You:</strong> ${escapeHtml(question)}<br>` +
            `<strong style="color:var(--accent-l)">Iris:</strong> ${escapeHtml(answer)}`;
          transcriptEl.style.display = 'block';
        }

        // Show answer in AI content panel too
        const existingAi = aiContent.innerHTML;
        aiContent.innerHTML =
          `<p class="ai-text"><em style="color:var(--accent-l)">Q: ${escapeHtml(question)}</em><br>${escapeHtml(answer)}</p>` +
          (existingAi.includes('ai-text') ? `<hr style="border-color:var(--border);margin:8px 0">` + existingAi : '');

        // Speak the answer
        irisStatus.textContent = 'Iris · speaking';
        irisWaves.classList.add('speaking');
        await speak(answer);
        irisWaves.classList.remove('speaking');
        irisStatus.textContent = 'Iris · ready';
        break;
      }

      case 'idle':
        btnMic.textContent = '🎙 Ask Iris';
        btnMic.classList.remove('listening');
        break;

      case 'error':
        btnMic.textContent = '🎙 Ask Iris';
        btnMic.classList.remove('listening');
        if (transcriptEl) {
          transcriptEl.textContent = typeof detail === 'string' ? detail : 'Something went wrong. Try again.';
          transcriptEl.style.display = 'block';
        }
        break;
    }
  });

  btnMic.addEventListener('click', () => conversation.toggle());
}

// ─── Start / Stop ────────────────────────────────────────────────────────────
async function startTracking() {
  if (modelLoading) return;
  modelLoading = true;

  btnStart.disabled = true;
  btnStart.innerHTML = '<span class="spinner"></span> Loading…';

  try {
    // 1. Camera
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
    videoEl.srcObject = stream;
    await videoEl.play();

    camDot.classList.add('live');
    camLabel.textContent = 'Live';
    btnStop.disabled = false;
    sessionStatusEl.textContent = '● LIVE';
    sessionStatusEl.classList.add('live');
    metricsLiveBadge.textContent = 'LIVE';
    metricsLiveBadge.classList.add('live');
    sessionStart = Date.now();
    timerInterval = setInterval(() => {
      const s = Math.floor((Date.now() - sessionStart) / 1000);
      const h = String(Math.floor(s / 3600)).padStart(2, '0');
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      const sec = String(s % 60).padStart(2, '0');
      if (sessionTimerEl) sessionTimerEl.textContent = `${h}:${m}:${sec}`;
    }, 1000);

    // 2. Load MediaPipe
    await Tracker.init();
    modelLoading = false;

    // 3. Set infected eye global (facetracker.js reads it)
    window.__infectedEye = Storage.getInfectedEye();

    // 4. Start loop
    frameCount   = 0;
    autoFlowDone = false;
    Tracker.start(videoEl, overlayEl, {
      onMeasurements: handleMeasurements,
      onBlink:        handleBlink,
      onFps:          fps => { if (fpsBadgeEl) fpsBadgeEl.textContent = fps + ' fps'; },
    });

    btnStart.textContent = '▶ Start Session';
    btnStart.disabled    = false;
    btnAnalyze.disabled  = false;

  } catch (err) {
    modelLoading = false;
    btnStart.disabled = false;
    btnStart.textContent = '▶ Start Session';
    alert(`Could not start: ${err.message}`);
  }
}

function stopTracking() {
  Tracker.stop();

  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  videoEl.srcObject = null;
  camDot.classList.remove('live');
  camLabel.textContent = 'Camera off';
  btnStop.disabled    = true;
  btnAnalyze.disabled = true;
  lastMeasurements    = null;
  frameCount          = 0;

  clearInterval(timerInterval);
  timerInterval = null;
  sessionStatusEl.textContent = '● OFFLINE';
  sessionStatusEl.classList.remove('live');
  metricsLiveBadge.textContent = 'STANDBY';
  metricsLiveBadge.classList.remove('live');
  if (infectionBadgeEl) infectionBadgeEl.className = 'hidden';
}

// ─── Measurement callback (called every frame) ───────────────────────────────
async function handleMeasurements(m, lidLeft, lidRight) {
  lastMeasurements = m;
  frameCount++;

  // Update numeric display
  earLeftEl.textContent  = m.earLeft.toFixed(3);
  earRightEl.textContent = m.earRight.toFixed(3);
  asymEl.textContent     = m.asymmetry.toFixed(1);
  relOpenEl.textContent  = m.relativeOpenness.toFixed(1);
  pfhLeftEl.textContent  = m.pfhLeft.toFixed(3);
  pfhRightEl.textContent = m.pfhRight.toFixed(3);
  blinkLEl.textContent   = Tracker.blinkCountLeft;
  blinkREl.textContent   = Tracker.blinkCountRight;

  // Header recovery score
  const score = Math.min(100, Math.round(m.relativeOpenness));
  if (recoveryScoreEl) recoveryScoreEl.textContent = score;

  // Progress bars
  const clampedOpen = Math.min(100, Math.max(0, m.relativeOpenness));
  const clampedAsym = Math.min(100, Math.max(0, m.asymmetry));
  if (opennessBarEl) opennessBarEl.style.width  = clampedOpen + '%';
  if (asymBarEl)     asymBarEl.style.height = clampedAsym + '%';

  // Recovery badge + infection badge
  let statusClass, statusLabel;
  if (m.relativeOpenness >= 85)      { statusClass = 'ok';       statusLabel = 'RECOVERING'; }
  else if (m.relativeOpenness >= 70) { statusClass = 'improving'; statusLabel = 'IMPROVING'; }
  else                               { statusClass = 'impaired';  statusLabel = 'IMPAIRED'; }

  if (recoveryBadgeEl) {
    recoveryBadgeEl.textContent = statusLabel;
    recoveryBadgeEl.className   = `recovery-badge ${statusClass}`;
  }
  if (infectionBadgeEl) {
    infectionBadgeEl.textContent = statusLabel;
    infectionBadgeEl.className   = statusClass;
  }

  // EAR card border highlight
  const infectedEye = Storage.getInfectedEye();
  if (earLeftCard)  earLeftCard.className  = `ear-card ${infectedEye === 'left'  ? 'infected' : 'healthy'}`;
  if (earRightCard) earRightCard.className = `ear-card ${infectedEye === 'right' ? 'infected' : 'healthy'}`;

  // EAR rings
  Charts.drawRing('ring-left',  m.earLeft,  infectedEye === 'left');
  Charts.drawRing('ring-right', m.earRight, infectedEye === 'right');

  // Lid profiles
  Charts.drawLidProfile('lid-left',  lidLeft,  infectedEye === 'left');
  Charts.drawLidProfile('lid-right', lidRight, infectedEye === 'right');

  // Chart timelines (throttle to ~1 Hz)
  if (frameCount % 25 === 0) Charts.updateCharts(m);

  // ── Automated Iris flow ──────────────────────────────────────────────────
  if (!autoFlowDone) {
    if (frameCount === GREETING_FRAME) {
      autoFlowDone = true; // prevent re-entry
      await runAutoFlow(m);
    }
  } else if (frameCount === ANALYSIS_FRAME) {
    // This branch handles the case where greeting completed and analysis frame arrives
    // (GREETING_FRAME defaults to 1, so this only fires for the second trigger point)
  }
}

// ─── Automated flow ───────────────────────────────────────────────────────────
async function runAutoFlow(initialMeasurements) {
  // 1. Greeting
  await speak(
    "Hello, I'm Iris, your eye recovery assistant. " +
    "I'm now tracking your eye movements and measuring openness. " +
    "Please look directly at the camera and keep still for a moment."
  );

  // 2. Wait for frame 75 worth of data (real measurement stabilisation)
  await waitForFrame(ANALYSIS_FRAME);

  const m = lastMeasurements ?? initialMeasurements;

  // 3. Read measurements
  const infectedSide = m.infectedEye === 'left' ? 'left' : 'right';
  const healthySide  = m.infectedEye === 'left' ? 'right' : 'left';

  await speak(
    `Here are your current readings. ` +
    `Your ${infectedSide} eye asymmetry is ${m.asymmetry.toFixed(1)} percent compared to your ${healthySide} eye. ` +
    `Your infected eye is at ${m.relativeOpenness.toFixed(0)} percent openness relative to your healthy eye. ` +
    `Left E-A-R is ${m.earLeft.toFixed(2)}, right is ${m.earRight.toFixed(2)}.`
  );

  // 4. AI analysis
  let analysis = '';
  try {
    setAiStatus('Analyzing…', true);
    const imageBase64 = Tracker.captureFrame(videoEl);
    analysis = await analyzeFrame(imageBase64, m, lastAiAnalysis);
    lastAiAnalysis = analysis;
    renderAiPanel(analysis);
  } catch (err) {
    analysis = `AI analysis unavailable: ${err.message}`;
    renderAiPanel(analysis);
  }

  // 5. Narrate AI findings
  await speak("Here's the AI analysis for your better understanding. " + analysis);
}

function waitForFrame(target) {
  return new Promise(resolve => {
    function check() {
      if (frameCount >= target) { resolve(); return; }
      requestAnimationFrame(check);
    }
    check();
  });
}

// ─── Manual re-analyze ───────────────────────────────────────────────────────
async function doAnalyze() {
  if (!lastMeasurements) return;
  btnAnalyze.disabled = true;

  try {
    setAiStatus('Analyzing…', true);
    const imageBase64 = Tracker.captureFrame(videoEl);
    const analysis = await analyzeFrame(imageBase64, lastMeasurements, lastAiAnalysis);
    lastAiAnalysis = analysis;
    renderAiPanel(analysis);
    await speak("New analysis complete. " + analysis);
  } catch (err) {
    renderAiPanel(`Analysis failed: ${err.message}`);
  } finally {
    btnAnalyze.disabled = false;
  }
}

// ─── Snapshot ────────────────────────────────────────────────────────────────
function takeSnapshot() {
  if (!lastMeasurements) { alert('Start tracking first.'); return; }

  const imageBase64 = Tracker.captureFrame(videoEl);
  const note = snapNoteEl?.value?.trim() ?? '';

  const snap = {
    id:           Date.now().toString(),
    timestamp:    new Date().toISOString(),
    image:        imageBase64,
    measurements: { ...lastMeasurements },
    notes:        note,
    aiAnalysis:   lastAiAnalysis,
  };

  Storage.addSnapshot(snap);
  if (snapNoteEl) snapNoteEl.value = '';
  renderGallery();
  speak('Snapshot saved.');
}

// ─── Gallery rendering ────────────────────────────────────────────────────────
function renderGallery() {
  const snaps = Storage.getSnapshots();

  if (!snaps.length) {
    galleryEmpty.style.display = '';
    // Remove old thumbs
    [...galleryGrid.querySelectorAll('.snap-thumb')].forEach(el => el.remove());
    return;
  }

  galleryEmpty.style.display = 'none';
  galleryGrid.innerHTML = '';

  snaps.forEach(snap => {
    const thumb = document.createElement('div');
    thumb.className = 'snap-thumb';
    thumb.dataset.id = snap.id;

    const img = document.createElement('img');
    img.src = 'data:image/jpeg;base64,' + snap.image;
    img.alt = 'Snapshot';

    const date = document.createElement('div');
    date.className = 'snap-date';
    date.textContent = new Date(snap.timestamp).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    });

    thumb.appendChild(img);
    thumb.appendChild(date);
    thumb.addEventListener('click', () => openModal(snap.id));
    galleryGrid.appendChild(thumb);
  });
}

function openModal(id) {
  const snap = Storage.getSnapshotById(id);
  if (!snap) return;

  currentModalId = id;
  modalImg.src   = 'data:image/jpeg;base64,' + snap.image;
  modalTitle.textContent = new Date(snap.timestamp).toLocaleString();

  const m = snap.measurements;
  modalMetrics.innerHTML = [
    { label: 'EAR Left',         value: m.earLeft  },
    { label: 'EAR Right',        value: m.earRight  },
    { label: 'Asymmetry',        value: m.asymmetry + '%' },
    { label: 'Rel. Openness',    value: m.relativeOpenness + '%' },
    { label: 'PFH Left',         value: m.pfhLeft  },
    { label: 'PFH Right',        value: m.pfhRight  },
  ].map(({ label, value }) => `
    <div class="modal-metric glass">
      <div class="modal-metric-label">${label}</div>
      <div class="modal-metric-value">${value}</div>
    </div>
  `).join('');

  modalNotes.innerHTML = '';
  if (snap.notes) {
    const p = document.createElement('p');
    p.textContent = '📝 ' + snap.notes;
    modalNotes.appendChild(p);
  }
  if (snap.aiAnalysis) {
    const p = document.createElement('p');
    p.style.marginTop = snap.notes ? '8px' : '0';
    p.textContent = '🤖 ' + snap.aiAnalysis;
    modalNotes.appendChild(p);
  }

  snapModal.classList.add('open');
}

function closeModal() {
  snapModal.classList.remove('open');
  currentModalId = null;
}

// ─── AI panel helpers ─────────────────────────────────────────────────────────
function setAiStatus(msg, loading = false) {
  aiContent.innerHTML = loading
    ? `<div style="display:flex;gap:8px;align-items:center"><span class="spinner"></span> ${msg}</div>`
    : `<p class="ai-placeholder">${msg}</p>`;
  aiTimestamp.style.display = 'none';
}

function renderAiPanel(text) {
  // Try to extract condition + severity from first line heuristically
  aiContent.innerHTML = `<p class="ai-text">${escapeHtml(text)}</p>`;
  aiTimestamp.style.display = '';
  aiTimestamp.textContent   = 'Last analysis: ' + new Date().toLocaleTimeString();
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function loadSettingsIntoUI() {
  claudeKeyEl.value    = Storage.getClaudeKey();
  elevenKeyEl.value    = Storage.getElevenKey();
  elevenVoiceEl.value  = Storage.getElevenVoice() === 'EXAVITQu4vr4xnSDxMaL' ? '' : Storage.getElevenVoice();

  setActiveToggle(voiceEngToggle,  Storage.getVoiceEngine());
  setActiveToggle(infectedToggle,  Storage.getInfectedEye());
}

function saveSettings() {
  Storage.setClaudeKey(claudeKeyEl.value.trim());
  Storage.setElevenKey(elevenKeyEl.value.trim());
  Storage.setElevenVoice(elevenVoiceEl.value.trim());
  Storage.setVoiceEngine(getActiveToggle(voiceEngToggle));
  Storage.setInfectedEye(getActiveToggle(infectedToggle));

  window.__infectedEye = Storage.getInfectedEye();
  updateLidTags();
  settingsPanel.classList.remove('open');
}

function updateLidTags() {
  const infected = Storage.getInfectedEye();
  if (leftLidTag) {
    leftLidTag.textContent = infected === 'left' ? 'infected' : 'healthy';
    leftLidTag.className   = 'lid-tag ' + (infected === 'left' ? 'infected' : 'healthy');
  }
  if (rightLidTag) {
    rightLidTag.textContent = infected === 'right' ? 'infected' : 'healthy';
    rightLidTag.className   = 'lid-tag ' + (infected === 'right' ? 'infected' : 'healthy');
  }
}

// ─── Toggle helpers ───────────────────────────────────────────────────────────
function setActiveToggle(container, value) {
  container.querySelectorAll('.toggle-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === value);
  });
}

function getActiveToggle(container) {
  return container.querySelector('.toggle-opt.active')?.dataset.val ?? '';
}

// ─── Blink callback ───────────────────────────────────────────────────────────
function handleBlink(side) {
  if (side === 'left')  blinkLEl.textContent = Tracker.blinkCountLeft;
  if (side === 'right') blinkREl.textContent = Tracker.blinkCountRight;
}

// ─── Event wiring ─────────────────────────────────────────────────────────────
function wireEvents() {
  btnStart.addEventListener('click', startTracking);
  btnStop.addEventListener('click',  stopTracking);
  btnSnapshot.addEventListener('click', takeSnapshot);
  btnAnalyze.addEventListener('click', doAnalyze);
  btnExport.addEventListener('click', Storage.exportSnapshots);

  btnSettings.addEventListener('click', () => {
    loadSettingsIntoUI();
    settingsPanel.classList.add('open');
  });
  settingsSave.addEventListener('click',   saveSettings);
  settingsCancel.addEventListener('click', () => settingsPanel.classList.remove('open'));
  settingsClose.addEventListener('click',  () => settingsPanel.classList.remove('open'));

  // Toggle buttons (voice engine + infected eye)
  [voiceEngToggle, infectedToggle].forEach(container => {
    container.querySelectorAll('.toggle-opt').forEach(btn => {
      btn.addEventListener('click', () => setActiveToggle(container, btn.dataset.val));
    });
  });

  // Modal
  modalClose.addEventListener('click', closeModal);
  snapModal.addEventListener('click', e => { if (e.target === snapModal) closeModal(); });
  modalDelete.addEventListener('click', () => {
    if (!currentModalId) return;
    if (confirm('Delete this snapshot?')) {
      Storage.deleteSnapshot(currentModalId);
      renderGallery();
      closeModal();
    }
  });

  btnClearHistory.addEventListener('click', () => {
    if (confirm('Delete all snapshots? This cannot be undone.')) {
      Storage.clearSnapshots();
      renderGallery();
    }
  });

  // Close panels on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      settingsPanel.classList.remove('open');
      closeModal();
    }
  });
}
