# Research Summary — CosyVoice 3 Integration

## Key Findings

**Stack:** CosyVoice 3 `Fun-CosyVoice3-0.5B-2512` via self-hosted FastAPI on RunPod Serverless. HTTP multipart/form-data from Fly.io worker. Raw PCM output → WAV header wrapping. No changes to existing stack (React Router v7, Prisma, Tigris, pgmq).

**Table Stakes:** TTS engine selector in UI, dynamic language filtering, cross-lingual synthesis without accent bleed, per-speaker reference audio, PCM-to-WAV conversion. Speaker diarization accuracy improvements via `speakers_expected` parameter and enhanced smoothing.

**Watch Out For:**
- PCM output is NOT WAV — must wrap with header (24kHz, mono, int16)
- `cross_lingual` mode must NOT include `prompt_text`; `zero_shot` mode MUST include it with prefix
- Reference audio quality critical — 3–10s clean speech, no overlap
- RunPod cold starts add 30–90s to first segment only
- Speaker mix-ups are the #1 UX problem — `speakers_expected` + better smoothing addresses this

## Architecture Decision
**Strategy pattern** for TTS engines: `tts-engine.server.ts` routes to Fish Audio or CosyVoice based on `Translation.ttsEngine` field. Pipeline steps 5 (CLONE_VOICE) and 6 (SYNTHESIZE) use the abstraction. Both engines coexist indefinitely.

## Build Order Recommendation
1. Schema + CosyVoice service module (parallel)
2. TTS engine abstraction + pipeline integration
3. UI changes + speaker diarization improvements (parallel)

3 phases, coarse granularity. Dependencies are linear with parallel opportunities.
