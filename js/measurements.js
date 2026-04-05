/**
 * measurements.js — Pure functions for all eye metrics.
 * All functions are stateless and accept raw landmark arrays.
 */

import {
  LEFT_EYE_EAR, RIGHT_EYE_EAR,
  LEFT_EYE_PFH, RIGHT_EYE_PFH,
  LEFT_PUPIL, RIGHT_PUPIL,
} from './config.js';

// ─── Euclidean distance between two 3D landmarks ────────────────────────────
function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * computeEAR — Eye Aspect Ratio from 6 landmark points.
 *
 * Indices are [P1, P2, P3, P4, P5, P6]:
 *   P1 = outer corner, P2 = top-outer, P3 = top-inner,
 *   P4 = inner corner, P5 = bot-inner, P6 = bot-outer
 *
 * EAR = (||P2−P6|| + ||P3−P5||) / (2 × ||P1−P4||)
 *
 * @param {Array} landmarks  — normalized landmark array from FaceLandmarker
 * @param {number[]} indices — 6-element index array
 * @returns {number} EAR value (0–1 range; normal ~0.20–0.30)
 */
export function computeEAR(landmarks, indices) {
  const [i1, i2, i3, i4, i5, i6] = indices;
  const p1 = landmarks[i1];
  const p2 = landmarks[i2];
  const p3 = landmarks[i3];
  const p4 = landmarks[i4];
  const p5 = landmarks[i5];
  const p6 = landmarks[i6];

  if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return 0;

  const vertical   = dist(p2, p6) + dist(p3, p5);
  const horizontal = 2 * dist(p1, p4);

  if (horizontal === 0) return 0;
  return vertical / horizontal;
}

/**
 * computePFH — Palpebral Fissure Height normalized by inter-pupillary distance.
 *
 * @param {Array} landmarks
 * @param {{ upper: number, lower: number }} pfhIndices
 * @param {number} leftPupilIdx
 * @param {number} rightPupilIdx
 * @returns {number} normalized PFH
 */
export function computePFH(landmarks, pfhIndices, leftPupilIdx, rightPupilIdx) {
  const upper = landmarks[pfhIndices.upper];
  const lower = landmarks[pfhIndices.lower];
  const lp    = landmarks[leftPupilIdx];
  const rp    = landmarks[rightPupilIdx];

  if (!upper || !lower || !lp || !rp) return 0;

  const fissureHeight = dist(upper, lower);
  const ipd = dist(lp, rp);

  if (ipd === 0) return 0;
  return fissureHeight / ipd;
}

/**
 * computeAsymmetry — Percentage difference between left and right EAR.
 *
 * @param {number} earLeft
 * @param {number} earRight
 * @returns {number} asymmetry percentage (0–100+)
 */
export function computeAsymmetry(earLeft, earRight) {
  const maxEar = Math.max(earLeft, earRight);
  if (maxEar === 0) return 0;
  return (Math.abs(earLeft - earRight) / maxEar) * 100;
}

/**
 * computeRelativeOpenness — Infected eye EAR as % of healthy eye EAR.
 * Returns 100 if no valid data (healthy eye = 100% baseline).
 *
 * @param {number} infectedEAR
 * @param {number} healthyEAR
 * @returns {number} percentage (0–100+)
 */
export function computeRelativeOpenness(infectedEAR, healthyEAR) {
  if (healthyEAR === 0) return 100;
  return (infectedEAR / healthyEAR) * 100;
}

/**
 * computeLidProfile — 7 vertical (upper–lower) gaps per eye, normalized by eye width.
 * Used for drawing the lid profile canvas.
 *
 * @param {Array} landmarks
 * @param {Array<{upper: number, lower: number}>} profileIndices
 * @returns {number[]} 7 normalized gap values
 */
export function computeLidProfile(landmarks, profileIndices) {
  return profileIndices.map(({ upper, lower }) => {
    const u = landmarks[upper];
    const l = landmarks[lower];
    if (!u || !l) return 0;
    return Math.abs(u.y - l.y);  // normalized coords; absolute vertical gap
  });
}

/**
 * buildMeasurements — Convenience wrapper that returns all metrics in one object.
 *
 * @param {Array} landmarks   — FaceLandmarker normalized landmark array
 * @param {string} infectedEye — 'left' | 'right'
 * @returns {object} full measurements snapshot
 */
export function buildMeasurements(landmarks, infectedEye) {
  const earLeft  = computeEAR(landmarks, LEFT_EYE_EAR);
  const earRight = computeEAR(landmarks, RIGHT_EYE_EAR);

  const pfhLeft  = computePFH(landmarks, LEFT_EYE_PFH,  LEFT_PUPIL, RIGHT_PUPIL);
  const pfhRight = computePFH(landmarks, RIGHT_EYE_PFH, LEFT_PUPIL, RIGHT_PUPIL);

  const asymmetry = computeAsymmetry(earLeft, earRight);

  const infectedEAR = infectedEye === 'left' ? earLeft : earRight;
  const healthyEAR  = infectedEye === 'left' ? earRight : earLeft;
  const relativeOpenness = computeRelativeOpenness(infectedEAR, healthyEAR);

  return {
    earLeft:   +earLeft.toFixed(3),
    earRight:  +earRight.toFixed(3),
    pfhLeft:   +pfhLeft.toFixed(3),
    pfhRight:  +pfhRight.toFixed(3),
    asymmetry: +asymmetry.toFixed(1),
    relativeOpenness: +relativeOpenness.toFixed(1),
    infectedEye,
    infectedEAR: +infectedEAR.toFixed(3),
    healthyEAR:  +healthyEAR.toFixed(3),
  };
}
