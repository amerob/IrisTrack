/**
 * conversation.js — Two-way voice conversation with Iris (Claude).
 *
 * Flow:
 *   1. User clicks mic button → recognition starts
 *   2. Speech is transcribed (interim shown live)
 *   3. Final transcript sent to Claude with measurement context
 *   4. Answer spoken via voice.js speak() and shown in UI
 */

import { CLAUDE_MODEL } from './config.js';
import { getClaudeKey } from './storage.js';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

export function createConversation() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('[conversation] SpeechRecognition not supported — use Chrome or Edge');
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous     = false;
  recognition.interimResults = true;
  recognition.lang           = 'en-US';
  recognition.maxAlternatives = 1;

  let isListening   = false;
  let isProcessing  = false;   // true while waiting for Claude / speaking
  let onStateChange = null;
  let getContext    = null;

  recognition.onstart = () => {
    isListening = true;
    onStateChange?.('listening', '');
  };

  recognition.onend = () => {
    isListening = false;
    // Don't reset to idle if we're mid-processing — let answering/error handle it
    if (!isProcessing) onStateChange?.('idle', '');
  };

  recognition.onerror = (e) => {
    isListening  = false;
    isProcessing = false;
    console.warn('[conversation] SpeechRecognition error:', e.error);
    onStateChange?.('error', e.error === 'no-speech' ? 'No speech detected. Try again.' : e.error);
  };

  recognition.onresult = (event) => {
    const result     = event.results[event.results.length - 1];
    const transcript = result[0].transcript.trim();
    const isFinal    = result.isFinal;

    if (!isFinal) {
      onStateChange?.('interim', transcript);
      return;
    }

    if (!transcript) { isProcessing = false; return; }

    // Hand off to async handler — don't await here (event handler must be sync)
    isProcessing = true;
    handleFinalTranscript(transcript);
  };

  async function handleFinalTranscript(transcript) {
    onStateChange?.('processing', transcript);
    try {
      const ctx    = getContext?.() ?? {};
      const answer = await askClaude(transcript, ctx.measurements, ctx.lastAnalysis);
      onStateChange?.('answering', { question: transcript, answer });
    } catch (err) {
      console.error('[conversation] Claude error:', err);
      onStateChange?.('error', `Iris error: ${err.message}`);
    } finally {
      isProcessing = false;
    }
  }

  return {
    start() {
      if (isListening || isProcessing) return;
      try { recognition.start(); } catch (e) { console.warn('[conv] start failed:', e); }
    },
    stop() {
      if (!isListening) return;
      try { recognition.stop(); } catch (_) {}
    },
    toggle() {
      isListening ? this.stop() : this.start();
    },
    setStateCallback(fn)   { onStateChange = fn; },
    setContextProvider(fn) { getContext = fn; },
    get isListening()      { return isListening; },
    get isProcessing()     { return isProcessing; },
  };
}

// ─── Claude Q&A ──────────────────────────────────────────────────────────────

async function askClaude(question, measurements, priorAnalysis) {
  const apiKey = getClaudeKey();
  if (!apiKey) {
    return 'Please add your Claude API key in Settings so I can answer your questions.';
  }

  const mCtx = measurements ? `
Current live measurements:
• Infected eye: ${measurements.infectedEye}
• EAR left: ${measurements.earLeft}  |  EAR right: ${measurements.earRight}
• Asymmetry: ${measurements.asymmetry}%
• Relative openness (infected vs healthy): ${measurements.relativeOpenness}%
• PFH left: ${measurements.pfhLeft}  |  PFH right: ${measurements.pfhRight}` : '';

  const aCtx = priorAnalysis
    ? `\nLatest AI visual diagnosis: "${priorAnalysis}"`
    : '';

  const system = `You are Iris, a compassionate AI assistant specializing in eye health and infection recovery. The user is monitoring their eye infection at home with a real-time tracking dashboard.

Answer their question accurately and helpfully in 2–3 sentences maximum. Be warm and concise — your reply will be spoken aloud. Always recommend seeing a doctor for anything that could be serious.
${mCtx}${aCtx}`;

  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key':                                 apiKey,
      'anthropic-version':                         '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'Content-Type':                              'application/json',
    },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: 256,
      system,
      messages: [{ role: 'user', content: question }],
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`Claude ${res.status}: ${txt}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text?.trim() ?? 'I could not generate a response.';
}
