# Architecture Research — CosyVoice 3 Integration

## Integration Pattern

```
Existing Pipeline (Fly.io)              New: GPU Host (RunPod Serverless)
┌────────────────────────┐              ┌─────────────────────────┐
│ pipeline.server.ts     │              │ CosyVoice 3 FastAPI     │
│                        │              │ Docker + NVIDIA GPU     │
│ Step 5: CLONE_VOICE    │              │                         │
│  → extract per-speaker │              │ POST /inference         │
│    reference audio     │              │  → multipart/form-data  │
│  → (Fish Audio: create │              │  → tts_text, mode,      │
│     persistent model)  │              │    prompt_wav, speed    │
│  → (CosyVoice: cache   │              │  → returns raw PCM     │
│     reference WAV)     │──HTTP POST──▶│    (24kHz, mono, int16) │
│                        │              │                         │
│ Step 6: SYNTHESIZE     │              └─────────────────────────┘
│  → per-segment TTS     │
│  → (CosyVoice: send    │
│     ref audio + text)  │
│  → PCM→WAV conversion  │
│  → time-stretch        │
│  → concatenate         │
└────────────────────────┘
```

## Component Changes

### New Components
1. **`cosyvoice.server.ts`** — CosyVoice 3 HTTP client (multipart/form-data, PCM→WAV)
2. **`tts-engine.server.ts`** — Strategy pattern to route between Fish Audio and CosyVoice based on translation config
3. **Prisma migration** — Add `ttsEngine` enum and field to `Translation` model

### Modified Components
1. **`pipeline.server.ts`** — Steps 5+6 use TTS engine abstraction instead of direct Fish Audio calls
2. **`assemblyai.server.ts`** — Pass `speakers_expected` hint when available
3. **`new-translation.tsx`** — Add engine selector, dynamic language list
4. **`app/utils/constants.ts`** — Language lists per engine

### Unchanged Components
- `worker.ts`, `worker.server.ts` — Same queue flow
- `tigris.server.ts` — Same storage patterns
- `openai.server.ts` — Translation is language-agnostic
- `ffmpeg.server.ts` — Same audio processing (add one PCM→WAV function)
- `db.server.ts` — Same Prisma client
- Auth, admin, site routes — Untouched

## Data Flow Change
**Before:** Segment → Fish Audio TTS → WAV → time-stretch → concatenate
**After (CosyVoice):** Segment + speaker ref audio → CosyVoice → raw PCM → WAV header → time-stretch → concatenate
**After (Fish Audio):** Unchanged

## Build Order
1. Schema migration (ttsEngine field) — no dependencies
2. CosyVoice service module — independent of pipeline changes
3. TTS engine abstraction — depends on CosyVoice module
4. Pipeline integration — depends on TTS abstraction
5. Speaker diarization improvements — independent, can parallelize with 1-4
6. UI changes — depends on schema, can parallelize with 3-4
