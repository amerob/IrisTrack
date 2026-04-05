/**
 * facetracker.js — MediaPipe FaceLandmarker integration.
 * Initialises the model, runs the requestAnimationFrame loop,
 * draws the landmark overlay, and emits results via a callback.
 */

import { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs';
import {
  MEDIAPIPE_BASE_URL,
  LEFT_EYE_EAR, RIGHT_EYE_EAR,
  LEFT_LID_PROFILE, RIGHT_LID_PROFILE,
  BLINK_LEFT_IDX, BLINK_RIGHT_IDX, BLINK_THRESHOLD,
} from './config.js';
import { buildMeasurements, computeLidProfile } from './measurements.js';

// ─── Module state ────────────────────────────────────────────────────────────
let faceLandmarker = null;
let rafId          = null;
let isRunning      = false;

// Blink tracking (edge-detection: only count transitions closed→open)
let blinkLeftPrev  = false;
let blinkRightPrev = false;
export let blinkCountLeft  = 0;
export let blinkCountRight = 0;

// FPS tracking
let fpsFrames = 0;
let fpsLast   = performance.now();
let currentFps = 0;

/**
 * init — Load MediaPipe WASM and create the FaceLandmarker.
 * Must be called once before start().
 */
export async function init() {
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_BASE_URL);

  const modelOpts = {
    outputFaceBlendshapes: true,
    runningMode: 'VIDEO',
    numFaces: 1,
  };

  // Try GPU first; fall back to CPU if the delegate isn't supported
  for (const delegate of ['GPU', 'CPU']) {
    try {
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        ...modelOpts,
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate,
        },
      });
      console.log(`[facetracker] FaceLandmarker ready (delegate: ${delegate})`);
      return; // success
    } catch (err) {
      console.warn(`[facetracker] delegate ${delegate} failed:`, err.message);
      if (delegate === 'CPU') throw err; // both failed
    }
  }
}

/**
 * start — Begin the RAF detection loop.
 *
 * @param {HTMLVideoElement}  videoEl     — live camera stream
 * @param {HTMLCanvasElement} overlayEl   — overlay canvas (same size as video display)
 * @param {object}            callbacks
 *   .onMeasurements(measurements, lidLeft, lidRight) — called every frame with data
 *   .onBlink(side)                                   — called on each detected blink
 *   .onFps(fps)                                      — FPS updates
 */
export function start(videoEl, overlayEl, callbacks) {
  if (isRunning || !faceLandmarker) return;
  isRunning = true;
  blinkCountLeft = 0;
  blinkCountRight = 0;

  const ctx = overlayEl.getContext('2d');

  function loop() {
    if (!isRunning) return;
    rafId = requestAnimationFrame(loop);

    if (videoEl.readyState < 2) return;

    // ── Size canvas to the video element's DISPLAYED pixel dimensions ────
    // (not the raw video resolution) so one canvas pixel = one screen pixel.
    const cw = videoEl.clientWidth;
    const ch = videoEl.clientHeight;
    if (overlayEl.width !== cw || overlayEl.height !== ch) {
      overlayEl.width  = cw;
      overlayEl.height = ch;
    }

    const now = performance.now();
    const result = faceLandmarker.detectForVideo(videoEl, now);

    // FPS
    fpsFrames++;
    if (now - fpsLast >= 1000) {
      currentFps = fpsFrames;
      fpsFrames  = 0;
      fpsLast    = now;
      callbacks.onFps?.(currentFps);
    }

    ctx.clearRect(0, 0, cw, ch);

    if (!result.faceLandmarks?.length) return;

    const landmarks   = result.faceLandmarks[0];
    const blendshapes = result.faceBlendshapes?.[0]?.categories ?? [];

    // ── Compute object-fit:cover transform so landmarks map to screen ────
    // MediaPipe returns normalized coords (0–1) in raw video frame space.
    // object-fit:cover scales the video to fill the element, potentially
    // cropping one axis. We must apply the same transform to landmark coords.
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    const t  = getCoverTransform(vw, vh, cw, ch);

    // ── Measurements first (needed for overlay colours) ──────────────────
    const infectedEye = window.__infectedEye ?? 'left';
    const m = buildMeasurements(landmarks, infectedEye);

    // ── Draw overlay ─────────────────────────────────────────────────────
    drawOverlay(ctx, landmarks, vw, vh, t, infectedEye, m.relativeOpenness);

    // ── Blendshape blink detection ───────────────────────────────────────
    const blinkLeftScore  = blendshapes[BLINK_LEFT_IDX]?.score  ?? 0;
    const blinkRightScore = blendshapes[BLINK_RIGHT_IDX]?.score ?? 0;

    const blinkLeftNow  = blinkLeftScore  > BLINK_THRESHOLD;
    const blinkRightNow = blinkRightScore > BLINK_THRESHOLD;

    if (blinkLeftPrev && !blinkLeftNow) {
      blinkCountLeft++;
      callbacks.onBlink?.('left');
    }
    if (blinkRightPrev && !blinkRightNow) {
      blinkCountRight++;
      callbacks.onBlink?.('right');
    }
    blinkLeftPrev  = blinkLeftNow;
    blinkRightPrev = blinkRightNow;

    const lidLeft  = computeLidProfile(landmarks, LEFT_LID_PROFILE);
    const lidRight = computeLidProfile(landmarks, RIGHT_LID_PROFILE);

    callbacks.onMeasurements?.(m, lidLeft, lidRight);
  }

  rafId = requestAnimationFrame(loop);
}

/**
 * stop — Halt the detection loop.
 */
export function stop() {
  isRunning = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

// ─── Cover-transform helper ───────────────────────────────────────────────────

/**
 * getCoverTransform — Compute the scale + offset that object-fit:cover applies
 * when fitting a video of (vw × vh) into a container of (cw × ch).
 *
 * MediaPipe normalizes landmarks in raw video space (0–1).
 * To draw them in canvas space (which matches the displayed element),
 * apply:  px = lm.x * vw * scale + ox
 *         py = lm.y * vh * scale + oy
 */
function getCoverTransform(vw, vh, cw, ch) {
  if (!vw || !vh) return { scale: 1, ox: 0, oy: 0 };
  const scale = Math.max(cw / vw, ch / vh);
  const ox    = (cw - vw * scale) / 2;
  const oy    = (ch - vh * scale) / 2;
  return { scale, ox, oy };
}

/** Convert a normalized landmark to canvas display pixel coords. */
function px(lm, vw, vh, t) {
  return { x: lm.x * vw * t.scale + t.ox, y: lm.y * vh * t.scale + t.oy };
}

// ─── Overlay drawing ─────────────────────────────────────────────────────────

// Eye status colours
const COLOR_HEALTHY = '#00b4d8';  // steel-blue  — healthy eye
const COLOR_OK      = '#10b981';  // emerald     — infected eye ≥ 85% openness
const COLOR_MILD    = '#f59e0b';  // amber       — infected eye 70–84%
const COLOR_BAD     = '#ef4444';  // red         — infected eye < 70%

// Contour index sequences
const EYE_L_CONTOUR = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7, 33];
const EYE_R_CONTOUR = [362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382, 362];
const LIPS_OUTER    = [61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146,61];
const NOSE_RIDGE    = [168,6,197,195,5];

/** Draw full 898-edge tessellation, coords transformed through t. */
function drawFaceMesh(ctx, landmarks, vw, vh, t) {
  const connections = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
  if (!connections?.length) return;
  ctx.beginPath();
  for (const { start, end } of connections) {
    const a = landmarks[start];
    const b = landmarks[end];
    if (!a || !b) continue;
    const pa = px(a, vw, vh, t);
    const pb = px(b, vw, vh, t);
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
  }
  ctx.strokeStyle = 'rgba(59,130,246,0.32)';
  ctx.lineWidth   = 0.6;
  ctx.stroke();
}

/** Draw face oval + lips + nose, transformed through t. */
function drawFaceContours(ctx, landmarks, vw, vh, t) {
  const oval = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL;
  if (oval?.length) {
    ctx.beginPath();
    for (const { start, end } of oval) {
      const a = landmarks[start];
      const b = landmarks[end];
      if (!a || !b) continue;
      const pa = px(a, vw, vh, t);
      const pb = px(b, vw, vh, t);
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.strokeStyle = 'rgba(99,160,255,0.65)';
    ctx.lineWidth   = 1.2;
    ctx.stroke();
  }
  [LIPS_OUTER, NOSE_RIDGE].forEach(seq => drawSeqPath(ctx, landmarks, seq, vw, vh, t, 'rgba(99,160,255,0.45)', 1));
}

/** Pick color for the infected eye based on relative openness vs healthy baseline. */
function infectedEyeColor(relativeOpenness) {
  if (relativeOpenness >= 85) return COLOR_OK;
  if (relativeOpenness >= 70) return COLOR_MILD;
  return COLOR_BAD;
}

/** Draw a sequential index path with cover transform applied. */
function drawSeqPath(ctx, landmarks, indices, vw, vh, t, color, lineWidth = 1, close = false) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth   = lineWidth;
  indices.forEach((idx, i) => {
    const lm = landmarks[idx];
    if (!lm) return;
    const p = px(lm, vw, vh, t);
    i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
  });
  if (close) ctx.closePath();
  ctx.stroke();
}

/** Draw filled dots with cover transform applied. */
function drawDots(ctx, landmarks, indices, vw, vh, t, color, radius = 3) {
  ctx.fillStyle = color;
  indices.forEach(idx => {
    const lm = landmarks[idx];
    if (!lm) return;
    const p = px(lm, vw, vh, t);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * drawOverlay — Full face mesh + colour-coded eye contours.
 * All landmark coords transformed through the cover-scale matrix t.
 */
function drawOverlay(ctx, landmarks, vw, vh, t, infectedEye = 'left', relativeOpenness = 50) {
  // 1. Full tessellation
  drawFaceMesh(ctx, landmarks, vw, vh, t);

  // 2. Face oval + secondary contours
  drawFaceContours(ctx, landmarks, vw, vh, t);

  // 3. Eye contours — colour coded
  const infColor   = infectedEyeColor(relativeOpenness);
  const leftColor  = infectedEye === 'left'  ? infColor : COLOR_HEALTHY;
  const rightColor = infectedEye === 'right' ? infColor : COLOR_HEALTHY;

  drawSeqPath(ctx, landmarks, EYE_L_CONTOUR, vw, vh, t, leftColor,  2, true);
  drawSeqPath(ctx, landmarks, EYE_R_CONTOUR, vw, vh, t, rightColor, 2, true);

  // 4. EAR measurement dots (slightly larger for visibility)
  drawDots(ctx, landmarks, LEFT_EYE_EAR,  vw, vh, t, leftColor,  3.5);
  drawDots(ctx, landmarks, RIGHT_EYE_EAR, vw, vh, t, rightColor, 3.5);
}

/**
 * captureFrame — Capture the current video frame as a base64 JPEG.
 * Used by ai.js before sending to Claude Vision.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {number} quality — JPEG quality 0–1
 * @returns {string} base64-encoded JPEG (without the data URL prefix)
 */
export function captureFrame(videoEl, quality = 0.85) {
  const canvas = document.createElement('canvas');
  canvas.width  = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  // Return only the base64 part (strip "data:image/jpeg;base64,")
  return dataUrl.split(',')[1];
}
