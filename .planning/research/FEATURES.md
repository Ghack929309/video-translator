# Features Research — CosyVoice 3 Integration

## Table Stakes (Must Have)
- **TTS engine selection** — User can choose between Fish Audio and CosyVoice 3
- **Dynamic language filtering** — Language options update based on selected engine
- **Cross-lingual synthesis** — CosyVoice generates native-sounding speech without accent bleed
- **Per-speaker voice cloning** — Each speaker's timbre preserved via reference audio
- **PCM-to-WAV conversion** — Handle CosyVoice raw PCM output format
- **Pipeline integration** — CosyVoice slots into existing CLONE_VOICE + SYNTHESIZE steps
- **Speaker diarization accuracy** — Reduce speaker voice mix-ups in multi-speaker outputs

## Differentiators (Competitive Advantage)
- **Accent-free dubbing** — CosyVoice 3's supervised semantic tokens disentangle speaker identity from language
- **Cost reduction** — $4–8/mo GPU vs $16–26/mo Fish Audio API
- **Full model control** — Self-hosted, version pinned, no rate limits

## Anti-Features (Deliberately Not Building)
- **Pronunciation inpainting UI** — CosyVoice 3 supports it but deferred to future
- **Real-time/streaming TTS** — Offline processing only (`stream: "false"`)
- **Custom voice model persistence** — CosyVoice uses inline reference audio, not persistent models
- **RunPod warm workers** — Cold starts acceptable for async jobs

## Feature Dependencies
```
TTS Engine Selector (UI) ← Dynamic Language Filtering (UI)
                         ← CosyVoice Service Module (backend)
CosyVoice Service Module ← PCM-to-WAV Conversion (FFmpeg)
                         ← RunPod Endpoint (infra)
Speaker Diarization Fix  ← AssemblyAI Config Tuning
                         ← Smoothing Algorithm Enhancement
Pipeline Integration     ← CosyVoice Service Module
                         ← Schema Migration (ttsEngine field)
```
