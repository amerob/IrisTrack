/**
 * storage.js — localStorage helpers for API keys, settings, and snapshots.
 */

import { KEYS, ELEVEN_DEFAULT_VOICE } from './config.js';

// ─── Settings ────────────────────────────────────────────────────────────────

export function getClaudeKey()    { return localStorage.getItem(KEYS.CLAUDE_KEY) ?? ''; }
export function setClaudeKey(v)   { localStorage.setItem(KEYS.CLAUDE_KEY, v); }

export function getElevenKey()    { return localStorage.getItem(KEYS.ELEVEN_KEY) ?? ''; }
export function setElevenKey(v)   { localStorage.setItem(KEYS.ELEVEN_KEY, v); }

export function getElevenVoice()  { return localStorage.getItem(KEYS.ELEVEN_VOICE) || ELEVEN_DEFAULT_VOICE; }
export function setElevenVoice(v) { localStorage.setItem(KEYS.ELEVEN_VOICE, v || ELEVEN_DEFAULT_VOICE); }

export function getVoiceEngine()  { return localStorage.getItem(KEYS.VOICE_ENGINE) || 'elevenlabs'; }
export function setVoiceEngine(v) { localStorage.setItem(KEYS.VOICE_ENGINE, v); }

export function getInfectedEye()  { return localStorage.getItem(KEYS.INFECTED_EYE) || 'left'; }
export function setInfectedEye(v) { localStorage.setItem(KEYS.INFECTED_EYE, v); }

// ─── Snapshots ───────────────────────────────────────────────────────────────

/**
 * Snapshot schema:
 * {
 *   id:          string (timestamp-based)
 *   timestamp:   ISO string
 *   image:       base64 JPEG (no data URL prefix)
 *   measurements: { earLeft, earRight, pfhLeft, pfhRight, asymmetry, relativeOpenness, ... }
 *   notes:       string
 *   aiAnalysis:  string
 * }
 */

export function getSnapshots() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.SNAPSHOTS) || '[]');
  } catch {
    return [];
  }
}

function saveSnapshots(arr) {
  localStorage.setItem(KEYS.SNAPSHOTS, JSON.stringify(arr));
}

export function addSnapshot(snap) {
  const arr = getSnapshots();
  arr.unshift(snap);          // newest first
  saveSnapshots(arr);
  return snap;
}

export function deleteSnapshot(id) {
  const arr = getSnapshots().filter(s => s.id !== id);
  saveSnapshots(arr);
}

export function clearSnapshots() {
  localStorage.removeItem(KEYS.SNAPSHOTS);
}

export function getSnapshotById(id) {
  return getSnapshots().find(s => s.id === id) ?? null;
}

/**
 * exportSnapshots — Download all snapshots as a JSON file.
 */
export function exportSnapshots() {
  const data = JSON.stringify(getSnapshots(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `eyetrack_export_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
