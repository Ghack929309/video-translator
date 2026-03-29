---
phase: 11-fix-audio-pipeline
plan: 02
subsystem: audio-processing
tags: [ffmpeg, audio, background-preservation, ducking, time-stretch, quality-verification]

# Dependency graph
requires:
  - phase: 10-enhance-voice-cloning
    provides: "existing ffmpeg.server.ts with mixAudioAbsolute and timeStretchExact methods"
provides:
  - "extractAudioFullQuality: 44.1kHz stereo extraction for Demucs source separation"
  - "duckBackground: configurable dB volume reduction for background tracks"
  - "preMixAudio: speech + background mixing with normalize=0"
  - "isBackgroundMeaningful: volumedetect silence detection at -55dB threshold"
  - "verifyMergeOutput: post-merge quality checks (duration, size, audio stream)"
  - "timeStretchExact tightened to 0.7x-1.5x for natural-sounding pacing"
affects: [11-03-PLAN, 11-04-PLAN, pipeline-stepSeparateAudio, pipeline-stepMerge, pipeline-SYNTHESIZE]

# Tech tracking
tech-stack:
  added: []
  patterns: ["volumedetect for silence detection", "amix normalize=0 for pre-mixing without auto-reduction", "spawn-based FFmpeg for complex filter_complex operations"]

key-files:
  created: []
  modified: ["app/services/ffmpeg.server.ts"]

key-decisions:
  - "Tightened timeStretchExact from 0.4x-2.5x to 0.7x-1.5x per D-17 for natural sound"
  - "Background silence threshold at -55dB mean volume per D-07"
  - "Duck level defaults to -8dB per D-06 (simple volume filter, not dynamic sidechain)"
  - "Merge verification uses 2.0s duration drift tolerance per D-22"

patterns-established:
  - "volumedetect + regex parsing for audio level analysis"
  - "Pre-mix audio before video mux (two-pass approach per D-20)"

requirements-completed: [BG-01, MERGE-01, MERGE-03, PACE-03]

# Metrics
duration: 2min
completed: 2026-03-29
---

# Phase 11 Plan 02: FFmpeg Audio Toolkit Summary

**Five new FFmpeg methods for background preservation, ducking, pre-mixing, quality verification, and tightened 0.7x-1.5x time-stretch limits**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-29T18:10:34Z
- **Completed:** 2026-03-29T18:12:16Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Added extractAudioFullQuality for 44.1kHz stereo extraction (Demucs input, not 16kHz ASR mono)
- Added duckBackground (-8dB), preMixAudio (normalize=0), isBackgroundMeaningful (-55dB threshold), verifyMergeOutput (duration/size/stream checks)
- Tightened timeStretchExact limits from 0.4x-2.5x to 0.7x-1.5x for more natural-sounding pacing
- File grew from 451 to 644 lines, all following existing patterns (ffmpegPath, spawn, Ffmpeg(), [ffmpeg] log prefix)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add extractAudioFullQuality method and update timeStretchExact limits** - `69bd2bc` (feat)
2. **Task 2: Add duckBackground, preMixAudio, isBackgroundMeaningful, and verifyMergeOutput methods** - `01388b1` (feat)

## Files Created/Modified
- `app/services/ffmpeg.server.ts` - Added 5 new methods (extractAudioFullQuality, duckBackground, preMixAudio, isBackgroundMeaningful, verifyMergeOutput) and tightened timeStretchExact limits

## Decisions Made
- Tightened timeStretchExact from 0.4x-2.5x to 0.7x-1.5x per D-17 for natural sound quality
- Background silence threshold set at -55dB mean volume per D-07
- Duck level defaults to -8dB (simple volume filter, not dynamic sidechain) per D-06
- Merge verification uses 2.0s duration drift tolerance per D-22
- Pre-mix uses normalize=0 to prevent amix auto-volume-reduction per Pitfall 7

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Pre-existing TypeScript compilation error in ffmpeg.server.ts (`esModuleInterop` flag for fluent-ffmpeg import) - not caused by changes, not in scope to fix.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All 5 FFmpeg utility methods ready for Plans 03 and 04 to consume
- extractAudioFullQuality ready for pipeline stepSeparateAudio (Demucs integration)
- duckBackground + preMixAudio ready for pipeline stepMerge background preservation
- isBackgroundMeaningful ready for fallback logic when background is silent
- verifyMergeOutput ready for post-merge quality gate
- timeStretchExact limits ready for gap-aware pacing in SYNTHESIZE step

## Self-Check: PASSED

- FOUND: app/services/ffmpeg.server.ts
- FOUND: 69bd2bc (Task 1 commit)
- FOUND: 01388b1 (Task 2 commit)

---
*Phase: 11-fix-audio-pipeline*
*Completed: 2026-03-29*
