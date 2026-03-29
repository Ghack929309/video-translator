---
phase: 11-fix-audio-pipeline
plan: 01
subsystem: infra, database, api
tags: [prisma, demucs, fastapi, audio-separation, cosyvoice, docker]

# Dependency graph
requires:
  - phase: 05-cosyvoice-api-service
    provides: CosyVoice FastAPI server.py, Dockerfile, download_model.py
provides:
  - SEPARATE_AUDIO pipeline step enum value in Prisma schema
  - backgroundAudioKey, enableBackgroundMix, failedSegments, failedSegmentCount fields on Translation model
  - Readiness-gated /health endpoint (ready:false during loading, ready:true after warmup)
  - POST /separate endpoint for Demucs htdemucs audio source separation (vocals + background)
  - Demucs pre-baked in Docker image (pip install + model weight pre-download)
affects: [11-02, 11-03, 11-04, 11-05, pipeline-integration, merge-step]

# Tech tracking
tech-stack:
  added: [demucs==4.0.1]
  patterns: [readiness-gated health check, lazy singleton for GPU model, base64 audio transport]

key-files:
  modified:
    - prisma/schema.prisma
    - services/cosyvoice-api/server.py
    - services/cosyvoice-api/Dockerfile
    - services/cosyvoice-api/scripts/download_model.py
    - services/cosyvoice-api/requirements.txt

key-decisions:
  - "Demucs separator uses lazy singleton pattern to avoid loading model until first /separate call"
  - "READY flag set after warmup even if warmup fails (server still functional, just not warmed up)"
  - "Background audio = drums + bass + other (everything except vocals) from htdemucs 4-stem separation"

patterns-established:
  - "Readiness gate: READY=False at startup, READY=True after model load + warmup, /health returns ready field"
  - "Base64 audio transport: /separate returns base64-encoded WAV for background and vocals"

requirements-completed: [BG-01, TTS-R01, BG-03]

# Metrics
duration: 2min
completed: 2026-03-29
---

# Phase 11 Plan 01: Schema + Server Foundation Summary

**Prisma schema extended with SEPARATE_AUDIO pipeline step and background/failure tracking fields; CosyVoice server upgraded with readiness-gated /health and Demucs htdemucs /separate endpoint**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-29T18:10:30Z
- **Completed:** 2026-03-29T18:12:39Z
- **Tasks:** 2
- **Files modified:** 5 (+ 5 generated Prisma client files)

## Accomplishments
- Added SEPARATE_AUDIO to PipelineStep enum between EXTRACT_AUDIO and TRANSCRIBE, enabling the new audio separation pipeline step
- Added four new Translation model fields (backgroundAudioKey, enableBackgroundMix, failedSegments, failedSegmentCount) for background audio preservation and TTS failure tracking
- Upgraded CosyVoice /health endpoint with readiness gate (returns ready:false until model load and warmup complete)
- Added POST /separate endpoint using Demucs htdemucs for audio source separation into vocals and background tracks
- Pre-baked Demucs htdemucs model weights into Docker image to eliminate first-run download latency

## Task Commits

Each task was committed atomically:

1. **Task 1: Prisma schema migration** - `69bd2bc` (feat)
2. **Task 2: CosyVoice FastAPI server upgrades** - `7a6b599` (feat)

## Files Created/Modified
- `prisma/schema.prisma` - Added SEPARATE_AUDIO enum value and 4 new Translation fields
- `services/cosyvoice-api/server.py` - Readiness gate (READY flag), /health with ready field, /separate Demucs endpoint, lazy Demucs singleton
- `services/cosyvoice-api/requirements.txt` - Added demucs==4.0.1
- `services/cosyvoice-api/Dockerfile` - Pre-download Demucs htdemucs model during build
- `services/cosyvoice-api/scripts/download_model.py` - Belt-and-suspenders Demucs model pre-download

## Decisions Made
- Demucs separator uses lazy singleton pattern (loaded on first /separate call, not at startup) to keep CosyVoice model startup fast
- READY flag is set to True after warmup completes (even if warmup itself had a non-fatal warning), because the server is still functional
- Background audio is computed as drums + bass + other from htdemucs 4-stem separation (everything except vocals)
- Base64 encoding used for audio transport in /separate response to keep JSON-compatible responses

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None - all changes applied cleanly and verification passed.

## User Setup Required
None - no external service configuration required. Docker image build will pull demucs automatically.

## Next Phase Readiness
- Schema fields ready for downstream plans (11-02 through 11-05) to use backgroundAudioKey, failedSegments, etc.
- /separate endpoint ready for the pipeline integration plan to call from the Node.js worker
- /health readiness gate ready for health check polling in the Node.js CosyVoice service client
- Migration needs to be applied to the production database (`npx prisma migrate dev --name add-separate-audio-step-and-background-fields` or `npx prisma db push`)

## Self-Check: PASSED

All 5 source files confirmed present. Both commit hashes (69bd2bc, 7a6b599) verified in git log.

---
*Phase: 11-fix-audio-pipeline*
*Completed: 2026-03-29*
