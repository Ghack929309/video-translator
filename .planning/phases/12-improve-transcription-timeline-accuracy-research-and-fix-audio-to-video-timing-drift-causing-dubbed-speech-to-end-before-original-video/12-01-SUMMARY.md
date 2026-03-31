# Phase 12 — Plan 01 Summary

**Completed:** 2026-03-31
**Status:** DONE

## What Changed

### Task 1: timeStretchExact — fade-out instead of silence padding (ffmpeg.server.ts)

**Already completed prior to this execution.** The `apad=whole_dur` silence padding had already been replaced with `afade=t=out` fade-out approach. Verified:
- `grep "apad=whole_dur"` → 0 matches (old padding removed)
- `grep "afade=t=out"` → 2 matches (fade-out in truncate + shorter branches)
- `grep "no silence padding"` → 1 match (warning log present)

**Behavior:** When stretched audio is shorter than target, a gentle 0.1s fade-out is applied and the audio is returned at its actual duration. `mixAudioAbsolute` handles the natural gap via adelay positioning.

### Task 2: splitLongSegments function (pipeline.server.ts)

Added `splitLongSegments()` function and `MAX_SEGMENT_SEC = 15` constant above the `pipeline` object. The function:
- Splits translated segments longer than 15s at sentence boundaries (`.!?` followed by whitespace)
- Distributes timing proportionally by character count across sub-segments
- Logs a warning for single-sentence segments that can't be split
- Preserves all original segment properties via spread operator

Integrated into `stepSynthesize`:
- Called after `segments` is parsed from `translation.translatedJson`
- Synthesis loop iterates over `splitSegments` instead of `segments`
- All references updated: loop bounds, progress calculations, failure thresholds

## Verification

| Check | Result |
|-------|--------|
| `grep "function splitLongSegments"` | 1 match ✓ |
| `grep "MAX_SEGMENT_SEC = 15"` | 1 match ✓ |
| `grep "splitLongSegments(segments)"` | 1 match ✓ |
| `grep "for (let i = 0; i < splitSegments.length"` | 1 match ✓ |
| `npx tsc --noEmit` | 0 errors ✓ |

## Files Modified

- `app/services/pipeline.server.ts` — added `splitLongSegments`, `MAX_SEGMENT_SEC`, `TranslatedSegment` interface; integrated into `stepSynthesize`
- `app/services/ffmpeg.server.ts` — no changes needed (Task 1 was already done)
