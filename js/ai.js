/**
 * ai.js — Claude Vision API integration.
 * Sends a webcam frame + measurements to claude-sonnet-4-20250514 and returns
 * a structured diagnostic text (condition, severity, care tips).
 */

import { CLAUDE_MODEL, CLAUDE_MAX_TOKENS } from './config.js';
import { getClaudeKey } from './storage.js';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * analyzeFrame — Call Claude Vision with a base64 JPEG + measurement context.
 *
 * @param {string} imageBase64  — base64-encoded JPEG (no data URL prefix)
 * @param {object} measurements — from buildMeasurements()
 * @param {string} [priorAnalysis] — previous AI finding (for progress context)
 * @returns {Promise<string>} — AI diagnostic text, ready for narration
 */
export async function analyzeFrame(imageBase64, measurements, priorAnalysis = '') {
  const apiKey = getClaudeKey();
  if (!apiKey) {
    return 'No Claude API key configured. Add one in Settings to enable AI analysis.';
  }

  const measurementContext = buildMeasurementContext(measurements);
  const systemPrompt = buildSystemPrompt();
  const userPrompt   = buildUserPrompt(measurementContext, priorAnalysis);

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type:       'base64',
              media_type: 'image/jpeg',
              data:        imageBase64,
            },
          },
          {
            type: 'text',
            text: userPrompt,
          },
        ],
      },
    ],
  };

  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key':                          apiKey,
      'anthropic-version':                  '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'Content-Type':                       'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Claude API ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? 'No response from AI.';
}

// ─── Prompt helpers ───────────────────────────────────────────────────────────

function buildSystemPrompt() {
  return `You are Iris, a compassionate medical AI assistant specializing in eye health monitoring.
You are analyzing webcam images and objective measurements from a patient who has an eye infection and is tracking their recovery at home.

Your role:
- Identify the likely eye condition (e.g., stye/hordeolum, chalazion, blepharitis, conjunctivitis, periorbital edema, or other)
- Rate severity on a scale of 1–5 (1 = very mild, 5 = severe)
- Provide 2–3 specific, actionable home care tips
- Note any signs of improvement or concern compared to prior readings

Important constraints:
- Do NOT repeat the raw metric numbers — those were already narrated
- Be concise and calming — this is for daily home monitoring, not emergency triage
- Remind the user to see a doctor if severity is 4 or 5, or if symptoms worsen
- Keep the response under 120 words — it will be read aloud
- Write in plain conversational English, no markdown, no bullet points`;
}

function buildUserPrompt(measurementContext, priorAnalysis) {
  let prompt = `Please analyze the eye condition visible in this image. Here are the objective measurements already reported to the patient:\n\n${measurementContext}`;

  if (priorAnalysis) {
    prompt += `\n\nFor context, the previous AI analysis found: "${priorAnalysis}"`;
  }

  prompt += `\n\nProvide: (1) the likely condition, (2) severity 1–5, (3) care tips, (4) any progress notes. Do not repeat the numbers.`;

  return prompt;
}

function buildMeasurementContext(m) {
  const infectedSide = m.infectedEye === 'left' ? 'Left' : 'Right';
  const healthySide  = m.infectedEye === 'left' ? 'Right' : 'Left';

  return [
    `Infected eye: ${infectedSide}`,
    `EAR (infected): ${m.infectedEAR} | EAR (healthy): ${m.healthyEAR}`,
    `Left EAR: ${m.earLeft} | Right EAR: ${m.earRight}`,
    `Asymmetry: ${m.asymmetry}%`,
    `Relative openness of infected eye vs healthy: ${m.relativeOpenness}%`,
    `PFH Left: ${m.pfhLeft} | PFH Right: ${m.pfhRight}`,
  ].join('\n');
}
