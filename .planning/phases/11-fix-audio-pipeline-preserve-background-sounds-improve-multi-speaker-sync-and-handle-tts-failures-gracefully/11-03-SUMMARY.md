---
phase: 11-fix-audio-pipeline
plan: 03
subsystem: pipeline, tts-client
tags: [cosyvoice, pipeline, background-audio, demucs, tts-resilience, gap-pacing, merge]

# Dependency graph
requires:
  - phase: 11-01
    provides: "SEPARATE_AUDIO enum, backgroundAudioKey/enableBackgroundMix/failedSegments/failedSegmentCount fields, /health and /separate endpoints"
  - phase: 11-02
    provides: "extractAudioFullQuality, duckBackground, preMixAudio, isBackgroundMeaningful, verifyMergeOutput, tightened timeStretchExact 0.7x-1.5x"
provides:
  - "CosyVoice client with waitForHealth, separateAudio, 5-retry exponential backoff, pod restart detection, speed=1.0"
  - "8-step pipeline with SEPARATE_AUDIO between EXTRACT_AUDIO and TRANSCRIBE"
  - "Gap-aware pacing in SYNTHESIZE (no prosodySpeed, no avgCharsPerSec)"
  - "Failed segment tracking with >50% abort threshold"
  - "Two-pass merge: duck background -8dB, pre-mix speech+background, mux onto video"
  - "Post-merge quality verification before marking complete"
affects: [11-04, 11-05, pipeline-end-to-end, merge-quality]

# Tech tracking
tech-stack:
  added: []
  patterns: ["health check polling with readiness gate", "pod restart detection via error pattern matching", "gap-aware pacing: natural overflow into gaps before time-stretching", "two-pass audio merge: pre-mix then mux", "failed segment tracking with abort threshold"]

key-files:
  created: []
  modified:
    - app/services/cosyvoice.server.ts
    - app/services/pipeline.server.ts

key-decisions:
  - "Always synthesize at speed=1.0 -- no variable speed pacing (D-15)"
  - "Gap-aware pacing: allow natural overflow into gap before time-stretching (D-16)"
  - "Removed avgCharsPerSec and prosodySpeed variables entirely (D-19)"
  - "Pod restart detection uses error pattern matching (econnrefused, 502, 503, etc.) with health check recovery (D-10)"
  - "Failed segment tracking with >50% abort threshold -- partial results are better than complete failure (D-13/D-14)"
  - "SEPARATE_AUDIO catches all errors and falls back to speech-only -- never blocks pipeline (D-07)"
  - "Two-pass merge: duck background -8dB then pre-mix with speech before video mux (D-20)"
  - "Post-merge quality check verifies duration, size, and audio stream presence (D-22)"

patterns-established:
  - "Health check polling before GPU-dependent operations"
  - "Error-tolerant pipeline steps that fall back gracefully instead of throwing"
  - "Per-segment failure tracking with aggregate abort threshold"

requirements-completed: [BG-01, BG-03, TTS-R01, TTS-R02, TTS-R03, TTS-R04, TTS-R05, TTS-R06, TTS-R07, PACE-01, PACE-02, PACE-03, PACE-04, MERGE-01, MERGE-02, MERGE-03, MERGE-04]

# Metrics
duration: 6min
completed: 2026-03-29
---

# Phase 11 Plan 03: Pipeline Core Engineering Summary

**CosyVoice client rewritten with health check polling, Demucs /separate client, 5-retry exponential backoff with pod restart detection; pipeline overhauled to 8 steps with SEPARATE_AUDIO, gap-aware SYNTHESIZE at speed=1.0 with failed segment tracking, and two-pass MERGE with ducked background pre-mixing and quality verification**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-03-30T00:34:13Z
- **Completed:** 2026-03-30T00:40:57Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

### Task 1: CosyVoice Client Rewrite (cosyvoice.server.ts)
- Added `waitForHealth()` method that polls `/health` endpoint with 3-minute timeout until `ready:true` (D-08/D-09)
- Added `separateAudio()` method that POSTs to `/separate` endpoint for Demucs htdemucs audio source separation, returning background + vocals buffers (D-01/D-02)
- Increased `MAX_RETRIES` from 2 to 5 with exponential backoff delays `[2000, 4000, 8000, 16000, 30000]` ms (D-11)
- Added `isPodRestartError()` helper detecting connection refused, ECONNRESET, IN_QUEUE, 502/503, and network errors
- Added pod restart detection: when TTS fails after prior success, waits for health check recovery without counting as a retry (D-10)
- Changed speed parameter to always use `1.0` regardless of input -- removes variable speed pacing (D-15)
- Added `getPodBaseUrl()` helper to derive pod proxy URL from `RUNPOD_POD_ID` env var
- File grew from 177 to 307 lines

### Task 2: Pipeline Overhaul (pipeline.server.ts)
- Added `SEPARATE_AUDIO` to `PipelineStep` type, `ORDERED_STEPS` array (between EXTRACT_AUDIO and TRANSCRIBE), and `STEP_PROGRESS` (8 entries)
- Added `stepSeparateAudio()` method: extracts full-quality audio, sends to Demucs, checks if background is meaningful, uploads to Tigris; catches all errors and falls back to speech-only (D-04/D-07)
- Rewrote `stepSynthesize()`: removed `avgCharsPerSec` and `prosodySpeed` variables, always passes `1.0` speed to both CosyVoice and Fish Audio (D-15/D-19)
- Added gap-aware pacing: checks if generated audio fits within segment + gap before time-stretching (D-16)
- Added failed segment tracking: builds `{index, error}` array, stores in DB via `failedSegments` and `failedSegmentCount` fields (D-13)
- Added >50% abort threshold: throws when more than half of segments fail TTS (D-14)
- Added CosyVoice health check before synthesis loop (D-09)
- Rewrote `stepMerge()`: downloads background from Tigris, ducks by -8dB, pre-mixes speech + ducked background, then muxes onto video (D-20/D-21)
- Added post-merge quality check via `ffmpeg.verifyMergeOutput()` before uploading result (D-22)
- Updated pod pre-heating condition from `startIndex <= 5` to `startIndex <= 6` to cover SEPARATE_AUDIO step
- File grew from 1002 to 1180 lines

## Task Commits

**NOTE:** Git commit commands were blocked by the execution sandbox. Files are modified and staged but commits need to be created by the orchestrator.

Staged files:
1. `app/services/cosyvoice.server.ts` - CosyVoice client rewrite
2. `app/services/pipeline.server.ts` - Pipeline overhaul with 8 steps

Recommended commits:
1. **Task 1:** `feat(11-03): rewrite CosyVoice client with health check, /separate, robust retry, speed=1.0`
2. **Task 2:** `feat(11-03): add SEPARATE_AUDIO step, revise SYNTHESIZE with gap-aware pacing, revise MERGE with background pre-mixing`

## Files Created/Modified

- `app/services/cosyvoice.server.ts` (307 lines) - waitForHealth, separateAudio, 5-retry exponential backoff, pod restart detection, speed=1.0
- `app/services/pipeline.server.ts` (1180 lines) - 8-step pipeline with SEPARATE_AUDIO, gap-aware SYNTHESIZE, two-pass MERGE

## Decisions Made

1. Always synthesize at speed=1.0 -- variable speed pacing caused unnatural sound quality (D-15)
2. Gap-aware pacing: let TTS audio naturally overflow into the gap between segments before applying time-stretch; only stretch when audio extends beyond the gap (D-16)
3. Removed avgCharsPerSec and prosodySpeed entirely -- these were pre-computation hacks that conflicted with gap-aware pacing (D-19)
4. Pod restart detection uses error message pattern matching rather than explicit state tracking, since RunPod doesn't expose restart events (D-10)
5. SEPARATE_AUDIO is fully fault-tolerant: catches all errors and sets enableBackgroundMix=false to continue pipeline without background audio (D-07)
6. Failed segment threshold at 50% balances partial output quality against complete job failure (D-14)
7. Two-pass merge keeps video codec copy (-c:v copy) while allowing audio pre-processing, avoiding video re-encoding (D-21)
8. Post-merge quality check catches corrupt outputs (wrong duration, missing audio stream, tiny file) before they reach users (D-22)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reused existing video file path from EXTRACT_AUDIO step**
- **Found during:** Task 2 (stepSeparateAudio and stepMerge)
- **Issue:** EXTRACT_AUDIO saves video as `source.mp4`, but SEPARATE_AUDIO and MERGE expected `source-video.mp4`. If the video was already downloaded, it would download again unnecessarily.
- **Fix:** Added path fallback logic: check for `source-video.mp4` first, then `source.mp4`, then download from Tigris only if neither exists
- **Files modified:** app/services/pipeline.server.ts

**2. [Rule 2 - Missing functionality] Adjusted TRANSCRIBE step progress value**
- **Found during:** Task 2 (STEP_PROGRESS update)
- **Issue:** With 8 steps instead of 7, the initial progress for TRANSCRIBE needed to change from 25 to 28 to avoid the progress bar appearing to jump backward after SEPARATE_AUDIO
- **Fix:** Set TRANSCRIBE initial progress to 28 (between SEPARATE_AUDIO's 25 and TRANSCRIBE's final 38)
- **Files modified:** app/services/pipeline.server.ts

## Issues Encountered

- Git commit commands consistently blocked by execution sandbox -- all file modifications are staged but uncommitted. The orchestrator needs to create commits after execution completes.

## Known Stubs

None -- all data flows are wired end-to-end.

## User Setup Required

None -- no new environment variables or external configuration needed. The SEPARATE_AUDIO step uses the same RunPod pod that CosyVoice already runs on.

## Next Phase Readiness

- CosyVoice client ready for Plan 04 (UI integration) to call health check for pod status display
- Pipeline ready for end-to-end testing with real videos
- Background audio preservation chain complete: separate -> duck -> pre-mix -> mux
- Failed segment tracking ready for Plan 05 UI to display which segments had TTS failures
- Quality verification gate prevents corrupt outputs from reaching users

## Self-Check: PASSED (files verified, commits pending)

File existence verified via Glob:
- FOUND: app/services/cosyvoice.server.ts (307 lines, exceeds 250 min_lines)
- FOUND: app/services/pipeline.server.ts (1180 lines, exceeds 900 min_lines)
- FOUND: .planning/phases/.../11-03-SUMMARY.md

All acceptance criteria verified via grep:
- MAX_RETRIES = 5, RETRY_BACKOFF_MS, waitForHealth, separateAudio, isPodRestartError, clampedSpeed = 1.0
- SEPARATE_AUDIO in ORDERED_STEPS (23 occurrences), stepSeparateAudio method
- No executable avgCharsPerSec or prosodySpeed variables
- failedSegments tracking, >50% abort, gap-aware pacing
- preMixAudio, duckBackground(-8), verifyMergeOutput in stepMerge

Commits pending: sandbox blocked `git commit` -- orchestrator must commit staged files

---
*Phase: 11-fix-audio-pipeline*
*Completed: 2026-03-29*
