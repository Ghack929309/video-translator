# Phase 12 — Plan 02 Summary

**Completed:** 2026-03-31
**Status:** DONE
**Depends on:** Plan 01 (completed)

## What Changed

### Task 1: Revised gap-aware pacing decision tree (pipeline.server.ts)

Replaced the old two-branch gap-aware logic (lines ~988-1008) with a three-branch decision tree:

1. **Within 10% tolerance** → use as-is (no stretching)
2. **TTS longer than segment** → check if fits within segment + 80% of gap:
   - Yes → allow natural overflow
   - No → speed up via `timeStretchExact`
3. **TTS shorter than segment** → always stretch to fill the slot

**Key differences from old logic:**
- Old code: `actualGeneratedSec <= segDurationSec + gapSec` allowed SHORT TTS to pass through unstretched — **removed**
- Old code: flat `< 0.1` absolute tolerance — replaced with **10% relative tolerance**
- New code: short TTS is **always stretched** to fill segment duration (primary fix)
- Gap overflow uses `gapSec * 0.8` (80%) instead of full gap
- Every branch logs per-segment diagnostics

### Task 2: Post-synthesis timeline validation (pipeline.server.ts)

Added after `mixAudioAbsolute` call:
- Computes `synthDuration` via `ffmpeg.getDuration`
- Compares against `lastSegEndSec` (max of all segment end times) and `videoDurationSec`
- Logs: synthesized duration, last segment end, video duration, speech coverage %, audio-vs-segment status
- Warns when synthesized audio is <80% of expected speech timeline

Added synthesis summary log after the synthesis loop:
- `Synthesis complete: N audio parts from M segments (K failed)`

## Verification

| Check | Result |
|-------|--------|
| Old permissive condition removed | 0 matches ✓ |
| `grep "within.*tolerance, using as-is"` | 1 match ✓ |
| `grep "overflow into gap"` | 2 matches ✓ |
| `grep "gapSec * 0.8"` | 1 match ✓ |
| `grep "Timeline validation"` | 1 match ✓ |
| `grep "Speech coverage"` | 1 match ✓ |
| `grep "timing drift may be present"` | 1 match ✓ |
| `grep "Synthesis complete.*audio parts"` | 1 match ✓ |
| `npx tsc --noEmit` | 0 errors ✓ |

## Files Modified

- `app/services/pipeline.server.ts` — rewrote gap-aware pacing, added timeline validation logging
