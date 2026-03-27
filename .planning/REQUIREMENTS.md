# Requirements: Dubly — CosyVoice 3 Integration

**Defined:** 2026-03-26
**Core Value:** The translated video must sound natural — each speaker's voice preserved, speaking the target language without accent bleed.

## v1 Requirements

### TTS Engine

- [ ] **TTS-01**: User can select CosyVoice 3 or Fish Audio as the TTS engine when creating a new translation
- [ ] **TTS-02**: Language dropdown dynamically filters to show only languages supported by the selected engine
- [ ] **TTS-03**: CosyVoice 3 supports 9 languages (EN, ZH, JA, KO, DE, ES, FR, IT, RU)
- [ ] **TTS-04**: Fish Audio continues to support all 21 languages with no changes to existing behavior

### CosyVoice Integration

- [ ] **COSY-01**: CosyVoice service module sends multipart/form-data POST to inference endpoint with tts_text, mode, prompt_wav, and speed
- [ ] **COSY-02**: Service correctly selects `cross_lingual` mode when source and target languages differ
- [ ] **COSY-03**: Service correctly selects `zero_shot` mode when source and target languages match, including required prompt_text prefix
- [ ] **COSY-04**: Raw PCM response (24kHz, mono, int16) is converted to valid WAV with proper header
- [ ] **COSY-05**: Service validates response is non-empty and contains valid audio data
- [ ] **COSY-06**: Service retries failed requests with exponential backoff (max 2 retries)

### Pipeline Integration

- [ ] **PIPE-01**: Pipeline steps 5 (CLONE_VOICE) and 6 (SYNTHESIZE) route to the correct TTS engine based on translation config
- [ ] **PIPE-02**: CosyVoice path extracts per-speaker reference audio (3–10s clean speech) and caches locally for reuse across segments
- [ ] **PIPE-03**: CosyVoice path sends speaker reference audio inline with each synthesis call (no persistent voice models)
- [ ] **PIPE-04**: Synthesized audio from CosyVoice is time-stretched and concatenated identically to Fish Audio path
- [ ] **PIPE-05**: Pipeline resume-from-failure works correctly for both TTS engines

### Speaker Diarization

- [ ] **DIAR-01**: AssemblyAI transcription uses `speakers_expected` parameter when speaker count is determinable
- [ ] **DIAR-02**: Speaker label smoothing algorithm is improved to reduce voice mix-ups in multi-speaker outputs
- [ ] **DIAR-03**: Speaker assignments are logged for debugging multi-speaker issues

### Schema & Config

- [ ] **SCHM-01**: Translation model has `ttsEngine` field (enum: FISH_AUDIO, COSYVOICE) with FISH_AUDIO as default
- [ ] **SCHM-02**: `COSYVOICE_URL` environment variable added to Zod schema (optional, required when CosyVoice is selected)
- [ ] **SCHM-03**: Prisma migration runs without breaking existing data

## v2 Requirements

### Pronunciation Control

- **PRON-01**: User can mark specific words for pronunciation correction inline
- **PRON-02**: CosyVoice bracket phoneme notation applied to marked segments

### Performance

- **PERF-01**: RunPod warm workers to eliminate cold starts
- **PERF-02**: Batch inference for multiple segments in single request

## Out of Scope

| Feature | Reason |
|---------|--------|
| Pronunciation inpainting UI | Future capability, CosyVoice 3 supports it but deferred |
| Real-time/streaming TTS | Offline processing only, async jobs |
| Removing Fish Audio | Keeping for 12 languages CosyVoice doesn't cover |
| RunPod warm workers | Cold starts acceptable for async jobs, optimize later |
| Admin role enforcement | Separate concern, different milestone |
| Health check endpoint | Separate concern, different milestone |
| Test framework setup | Separate concern, different milestone |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TTS-01 | Phase 3 | Pending |
| TTS-02 | Phase 3 | Pending |
| TTS-03 | Phase 3 | Pending |
| TTS-04 | Phase 3 | Pending |
| COSY-01 | Phase 1 | Pending |
| COSY-02 | Phase 1 | Pending |
| COSY-03 | Phase 1 | Pending |
| COSY-04 | Phase 1 | Pending |
| COSY-05 | Phase 1 | Pending |
| COSY-06 | Phase 1 | Pending |
| PIPE-01 | Phase 2 | Pending |
| PIPE-02 | Phase 2 | Pending |
| PIPE-03 | Phase 2 | Pending |
| PIPE-04 | Phase 2 | Pending |
| PIPE-05 | Phase 2 | Pending |
| DIAR-01 | Phase 3 | Pending |
| DIAR-02 | Phase 3 | Pending |
| DIAR-03 | Phase 3 | Pending |
| SCHM-01 | Phase 1 | Pending |
| SCHM-02 | Phase 1 | Pending |
| SCHM-03 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-26*
*Last updated: 2026-03-26 after initial definition*
