# eyetrack. — Eye Infection Recovery Dashboard

> A browser-based AI medical dashboard for tracking eye infection recovery in real time using your webcam, Vision, and voice narration.

![eyetrack dashboard](https://img.shields.io/badge/status-active-10b981?style=flat-square) ![no backend](https://img.shields.io/badge/backend-none-3b82f6?style=flat-square) ![license](https://img.shields.io/badge/license-MIT-6366f1?style=flat-square)

---

## What It Does

eyetrack. uses your webcam + MediaPipe's 478-point face mesh to measure your eyes every frame and track how your infection recovers day by day. It also lets you have a real two-way voice conversation with **Iris**, an AI assistant, who can answer your questions about your condition.

| Feature | Detail |
|---|---|
| **Full face mesh** | 478 landmarks + 898 tessellation edges rendered live |
| **Eye tracking** | EAR, PFH, Asymmetry %, Relative Openness, Blink detection, Lid morphology |
| **Colour coding** | Infected eye: 🔴 red < 70% · 🟡 amber 70–84% · 🟢 green ≥ 85% |
| **AI Diagnosis** | Analyzes a webcam snapshot + measurements |
| **Voice narration** | Iris reads your measurements and AI findings aloud (ElevenLabs or System TTS) |
| **Two-way conversation** | Click "Ask Iris", speak a question, get a voice answer |
| **Session history** | Timestamped snapshots with notes saved in localStorage |
| **No backend** | 100% browser — no server, no database, no build tools |

---

## Quick Start

**Requires a local HTTP server** (ES modules can't load from `file://`).

### VS Code (recommended)
1. Install the **Live Server** extension (Ritwick Dey)
2. Right-click `index.html` → **Open with Live Server**
3. Browser opens at `http://127.0.0.1:5500`

### Python
```bash
cd path/to/eyetrack
python -m http.server 8080
# open http://localhost:8080
```

### Node
```bash
npx serve path/to/eyetrack
```

---

## Setup

1. Open the app and click **⚙ Settings**
2. Paste your **Anthropic API key** (enables Claude Vision + Iris conversation)
3. Optionally paste your **ElevenLabs API key** for a premium voice (falls back to browser TTS)
4. Select which eye is **infected** (Left / Right)
5. Click **Save**, then **▶ Start Session**

---

## Metrics Explained

| Metric | Formula | Normal Range |
|---|---|---|
| **EAR** (Eye Aspect Ratio) | `(‖P2−P6‖ + ‖P3−P5‖) / (2 × ‖P1−P4‖)` | 0.20 – 0.30 |
| **PFH** (Palpebral Fissure Height) | vertical lid gap / inter-pupillary distance | depends on person |
| **Relative Openness** | `infectedEAR / healthyEAR × 100` | 100% = fully recovered |
| **Asymmetry %** | `|earL − earR| / max(earL, earR) × 100` | < 5% = normal |
| **Blink detection** | MediaPipe blendshape `eyeBlink{L,R}` > 0.5 | — |
| **Lid Morphology** | 7-point upper/lower lid profile per eye | — |

---

## Iris — Two-Way Voice

Once the session is running:

1. Click **🎙 Ask Iris**
2. Speak your question (e.g. *"Is my eye improving compared to yesterday?"* or *"What does a chalazion look like?"*)
3. Iris answers based on your live measurements and prior AI diagnosis

Iris has access to your current EAR, asymmetry, relative openness, and the latest Claude analysis. She will always recommend seeing a doctor for severity 4–5 findings.

---

## Tech Stack

```
Presentation    HTML5 · CSS3 (dark navy medical theme) · JS ES Modules
Face tracking   MediaPipe FaceLandmarker @0.10.3 (478 landmarks, GPU→CPU fallback)
Measurements    EAR · PFH · Asymmetry · Lid profiles (pure JS, no dependencies)
Charts          Chart.js 4.4.4 (CDN)
AI Vision       Claude-sonnet-4-20250514 (direct browser fetch)
Voice out       ElevenLabs eleven_turbo_v2_5 → Web Speech API fallback
Voice in        Web Speech API SpeechRecognition (Chrome / Edge)
Persistence     localStorage (snapshots · API keys · preferences)
```

---

## File Structure

```
eyetrack/
├── index.html          UI shell — no framework, no bundler
├── css/style.css       Dark navy medical theme
├── js/
│   ├── config.js       Landmark indices, thresholds, storage keys
│   ├── measurements.js Pure EAR / PFH / asymmetry math
│   ├── facetracker.js  MediaPipe init, RAF loop, face mesh overlay
│   ├── charts.js       Chart.js timelines + ring canvases + lid canvas
│   ├── storage.js      localStorage helpers
│   ├── voice.js        ElevenLabs TTS + Web Speech fallback
│   ├── ai.js           Vision snapshot analysis
│   ├── conversation.js Two-way SpeechRecognition ↔ Claude Q&A
│   └── app.js          Orchestration, automated Iris flow, events
├── PLAN.md             Architecture decisions and fixes log
└── README.md           This file
```

---

## Eye Overlay Colour Guide

The infected eye contour changes colour in real time based on recovery progress:

| Colour | Meaning | Relative Openness |
|---|---|---|
| 🔴 **Red** | Significantly impaired | < 70% |
| 🟡 **Amber** | Improving | 70 – 84% |
| 🟢 **Green** | Recovering well | ≥ 85% |
| 🔵 **Cyan** | Healthy eye | always |

---

## API Keys

| Key | Where to get it | Stored |
|---|---|---|
| Anthropic | [console.anthropic.com](https://console.anthropic.com) | `localStorage` (device only) |
| ElevenLabs | [elevenlabs.io](https://elevenlabs.io) | `localStorage` (device only) |

Keys never leave your browser. All API calls are made directly from your browser to the respective API.

---

## Privacy

- **No data is sent to any server except** the AI APIs you configure
- Webcam frames are processed locally by MediaPipe WASM
- Snapshots are stored only in your browser's localStorage
- API keys are stored locally and never transmitted except to their respective APIs

---

## Limitations & Notes

- **Chrome / Edge only** for SpeechRecognition (Ask Iris voice input)
- Camera requires HTTPS or localhost (Live Server satisfies this)
- MediaPipe model (~30 MB) downloads on first load; cached by browser thereafter
- ElevenLabs TTS requires an internet connection and valid API key; System TTS works offline

---

## License

MIT © [amerob](https://github.com/amerob)

---

