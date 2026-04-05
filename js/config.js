/**
 * config.js — Shared constants: landmark indices, thresholds, storage keys.
 * All MediaPipe FaceLandmarker 478-point indices are defined here so other
 * modules never hard-code raw numbers.
 */

// ─── MediaPipe FaceLandmarker WASM base path ────────────────────────────────
export const MEDIAPIPE_BASE_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm';

// ─── Eye landmark indices (478-point model) ─────────────────────────────────
// Standard 6-point EAR layout per eye:
//   P1 = outer corner, P2 = top-outer, P3 = top-inner,
//   P4 = inner corner, P5 = bot-inner, P6 = bot-outer

export const LEFT_EYE_EAR  = [33, 160, 158, 133, 153, 144];
export const RIGHT_EYE_EAR = [362, 385, 387, 263, 373, 380];

// Upper eyelid mid + lower eyelid mid for PFH
export const LEFT_EYE_PFH  = { upper: 159, lower: 145, outer: 33, inner: 133 };
export const RIGHT_EYE_PFH = { upper: 386, lower: 374, outer: 263, inner: 362 };

// Pupil / iris centre landmarks (for IPD)
export const LEFT_PUPIL  = 468;   // iris centre (index 468 in 478-point model)
export const RIGHT_PUPIL = 473;

// 7 evenly-spaced upper/lower lid landmark pairs for lid profile drawing
// (horizontal sweep across each eye)
export const LEFT_LID_PROFILE = [
  { upper: 246, lower: 7   },
  { upper: 161, lower: 163 },
  { upper: 160, lower: 144 },
  { upper: 159, lower: 145 },
  { upper: 158, lower: 153 },
  { upper: 157, lower: 154 },
  { upper: 173, lower: 155 },
];

export const RIGHT_LID_PROFILE = [
  { upper: 466, lower: 249 },
  { upper: 388, lower: 390 },
  { upper: 387, lower: 373 },
  { upper: 386, lower: 374 },
  { upper: 385, lower: 380 },
  { upper: 384, lower: 381 },
  { upper: 398, lower: 382 },
];

// ─── Blendshape indices (52 blendshapes in FaceLandmarker output) ───────────
export const BLINK_LEFT_IDX  = 9;   // eyeBlinkLeft
export const BLINK_RIGHT_IDX = 10;  // eyeBlinkRight
export const BLINK_THRESHOLD = 0.5;

// ─── EAR normal range ────────────────────────────────────────────────────────
export const EAR_NORMAL_MIN = 0.20;
export const EAR_NORMAL_MAX = 0.30;

// ─── localStorage keys ───────────────────────────────────────────────────────
export const KEYS = {
  CLAUDE_KEY:     'eyetrack_claude_key',
  ELEVEN_KEY:     'eyetrack_11labs_key',
  ELEVEN_VOICE:   'eyetrack_11labs_voice',
  VOICE_ENGINE:   'eyetrack_voice_engine',
  INFECTED_EYE:   'eyetrack_infected_eye',
  SNAPSHOTS:      'eyetrack_snapshots',
};

// ─── ElevenLabs defaults ─────────────────────────────────────────────────────
export const ELEVEN_DEFAULT_VOICE = 'EXAVITQu4vr4xnSDxMaL'; // Sarah
export const ELEVEN_MODEL         = 'eleven_turbo_v2_5';

// ─── Anthropic defaults ──────────────────────────────────────────────────────
export const CLAUDE_MODEL      = 'claude-sonnet-4-20250514';
export const CLAUDE_MAX_TOKENS = 1024;

// ─── App timing ──────────────────────────────────────────────────────────────
export const GREETING_FRAME  = 1;    // speak greeting on first valid frame
export const ANALYSIS_FRAME  = 75;   // auto-trigger analysis at frame 75 (~3 s)
export const CHART_MAX_POINTS = 60;
