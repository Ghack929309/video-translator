# Roadmap: Dubly — CosyVoice 3 Integration

**Created:** 2026-03-26
**Milestone:** v1.1 — CosyVoice 3 TTS Engine
**Phases:** 3
**Granularity:** Coarse

## Overview

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| 1 | CosyVoice Service & Schema | Build the CosyVoice 3 client module and database schema to support dual TTS engines | COSY-01–06, SCHM-01–03 | 4 |
| 2 | Pipeline Integration | Wire CosyVoice into pipeline steps 5+6 with TTS engine abstraction | PIPE-01–05 | 3 |
| 3 | UI & Speaker Accuracy | Add engine selector to UI and improve speaker diarization accuracy | TTS-01–04, DIAR-01–03 | 4 |

---

## Phase 1: CosyVoice Service & Schema

**Goal:** Build the CosyVoice 3 HTTP client module and update the database schema to support dual TTS engines, so the pipeline has a working CosyVoice backend to call.

**Requirements:** COSY-01, COSY-02, COSY-03, COSY-04, COSY-05, COSY-06, SCHM-01, SCHM-02, SCHM-03

**UI hint:** no

**Success criteria:**
1. `cosyvoice.server.ts` can send multipart/form-data to a CosyVoice endpoint and receive valid audio back
2. Service correctly selects `cross_lingual` vs `zero_shot` mode based on source/target language comparison
3. Raw PCM response is converted to valid WAV file that FFmpeg can process
4. Prisma migration adds `ttsEngine` enum and field without breaking existing translations

**Dependencies:** None — foundational phase

---

## Phase 2: Pipeline Integration

**Goal:** Create a TTS engine abstraction and integrate CosyVoice into pipeline steps 5 (CLONE_VOICE) and 6 (SYNTHESIZE), so translations using CosyVoice produce dubbed output videos end-to-end.

**Requirements:** PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05

**UI hint:** no

**Success criteria:**
1. Pipeline routes to CosyVoice or Fish Audio based on `Translation.ttsEngine` field
2. CosyVoice path extracts per-speaker reference audio and sends it inline with each synthesis call
3. End-to-end translation using CosyVoice produces a valid dubbed video with time-aligned audio

**Dependencies:** Phase 1 (CosyVoice service module + schema)

---

## Phase 3: UI & Speaker Accuracy

**Goal:** Add TTS engine selection to the new translation UI with dynamic language filtering, and improve speaker diarization to reduce voice mix-ups in multi-speaker videos.

**Requirements:** TTS-01, TTS-02, TTS-03, TTS-04, DIAR-01, DIAR-02, DIAR-03

**UI hint:** yes

**Success criteria:**
1. New translation form shows engine selector with Fish Audio (default) and CosyVoice 3 options
2. Language dropdown updates dynamically when engine selection changes (9 vs 21 languages)
3. Speaker diarization uses `speakers_expected` parameter and improved smoothing for fewer voice mix-ups
4. Speaker assignments are logged for debugging multi-speaker issues

**Dependencies:** Phase 1 (schema for ttsEngine field), Phase 2 (pipeline works end-to-end)

### Phase 4: Implement the CosyVoice 3 API Service

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 3
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 4 to break down)

### Phase 5: Implement the CosyVoice 3 API Service

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 4
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 5 to break down)

### Phase 6: RunPod Auto-Scaler and Worker Status UI

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 5
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 6 to break down)

### Phase 7: RunPod Min-Worker Auto-Scaler

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 6
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 7 to break down)

### Phase 8: Migrate Serverless to On-Demand Pod Start Stop

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 7
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 8 to break down)

---

*Roadmap created: 2026-03-26*
*Last updated: 2026-03-26 after initial creation*
