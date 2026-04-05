/**
 * voice.js — Promise-based TTS with ElevenLabs primary + Web Speech API fallback.
 *
 * speak(text) → Promise<void>
 *   Resolves only after audio fully ends, ensuring sequential narration.
 */

import { ELEVEN_MODEL } from './config.js';
import { getElevenKey, getElevenVoice, getVoiceEngine } from './storage.js';

// ─── State ───────────────────────────────────────────────────────────────────
let isSpeaking  = false;
let onSpeakStart = null;
let onSpeakEnd   = null;

/** Register UI callbacks so voice.js stays UI-agnostic. */
export function setVoiceCallbacks(start, end) {
  onSpeakStart = start;
  onSpeakEnd   = end;
}

// ─── Main speak() ────────────────────────────────────────────────────────────

/**
 * speak — Narrate text via ElevenLabs (if key set + engine = elevenlabs),
 * otherwise fall back to the Web Speech API.
 *
 * @param {string} text
 * @returns {Promise<void>} resolves when audio finishes
 */
export async function speak(text) {
  if (!text?.trim()) return;

  const elKey  = getElevenKey();
  const engine = getVoiceEngine();

  // If ElevenLabs key exists, always try it first — don't let the engine
  // toggle override a key that's been configured. System TTS is fallback only.
  const tryEleven = !!(elKey && elKey.trim());

  isSpeaking = true;
  onSpeakStart?.();

  try {
    if (tryEleven) {
      await speakElevenLabs(text, elKey.trim());
    } else {
      onElevenError?.('No ElevenLabs key — using System TTS. Add a key in ⚙ Settings for Iris\'s real voice.');
      await speakWebSpeech(text);
    }
  } catch (err) {
    // ElevenLabs failed — show the error visibly so user knows why voice changed
    console.warn('[voice] ElevenLabs failed:', err.message);
    onElevenError?.(`ElevenLabs error: ${err.message} — fell back to System TTS.`);
    try { await speakWebSpeech(text); } catch (_) { /* silent fail */ }
  } finally {
    isSpeaking = false;
    onSpeakEnd?.();
  }
}

let onElevenError = null;
/** Register a callback shown when ElevenLabs fails, so the user sees why. */
export function setElevenErrorCallback(fn) { onElevenError = fn; }

export function getIsSpeaking() { return isSpeaking; }

// ─── ElevenLabs ──────────────────────────────────────────────────────────────

async function speakElevenLabs(text, apiKey) {
  const voiceId = getElevenVoice();
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key':   apiKey,
      'Content-Type': 'application/json',
      'Accept':       'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: ELEVEN_MODEL,
      voice_settings: {
        stability:         0.40,   // lower = more expressive / natural variation
        similarity_boost:  0.85,   // higher = closer to Sarah's true voice
        style:             0.30,   // adds warmth and expressiveness (v2 models)
        use_speaker_boost: true,   // enhances voice clarity
      },
    }),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`ElevenLabs ${res.status}: ${msg}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return playBuffer(arrayBuffer);
}

/** Decode an ArrayBuffer and play it via Web Audio API. Returns Promise<void>. */
async function playBuffer(arrayBuffer) {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded  = await audioCtx.decodeAudioData(arrayBuffer);
  const source   = audioCtx.createBufferSource();
  source.buffer  = decoded;
  source.connect(audioCtx.destination);

  return new Promise(resolve => {
    source.onended = () => {
      audioCtx.close().catch(() => {});
      resolve();
    };
    source.start(0);
  });
}

// ─── Web Speech API fallback ──────────────────────────────────────────────────

// Female voice names across macOS / Windows / Chrome / Edge
const FEMALE_VOICE_NAMES = /samantha|karen|victoria|moira|fiona|allison|susan|zira|hazel|serena|aria|jenny|sonia|libby|jane|natasha|veena|tessa|amelie|alice|laura|joana|paulina|helena/i;

/** Returns a Promise that resolves with the loaded voices list. */
function getVoices() {
  return new Promise(resolve => {
    const list = window.speechSynthesis.getVoices();
    if (list.length) { resolve(list); return; }
    // Voices load asynchronously on first call in Chrome/Edge
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      resolve(window.speechSynthesis.getVoices());
    }, { once: true });
  });
}

function speakWebSpeech(text) {
  return new Promise(async (resolve, reject) => {
    if (!window.speechSynthesis) {
      reject(new Error('Web Speech API not available'));
      return;
    }

    window.speechSynthesis.cancel();

    const voices = await getVoices();

    // Priority 1 — named female voices (macOS Samantha, Windows Zira/Jenny, etc.)
    // Priority 2 — any en-US female voice by gender tag
    // Priority 3 — any English voice
    const preferred =
      voices.find(v => FEMALE_VOICE_NAMES.test(v.name) && v.lang.startsWith('en')) ||
      voices.find(v => FEMALE_VOICE_NAMES.test(v.name)) ||
      voices.find(v => v.lang === 'en-US') ||
      voices.find(v => v.lang.startsWith('en')) ||
      voices[0];

    const utter  = new SpeechSynthesisUtterance(text);
    utter.rate   = 0.95;
    utter.pitch  = 1.1;   // slightly higher pitch → more feminine
    utter.volume = 1;
    if (preferred) utter.voice = preferred;

    utter.onend   = () => resolve();
    utter.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') resolve();
      else reject(new Error(e.error));
    };

    window.speechSynthesis.speak(utter);
  });
}
