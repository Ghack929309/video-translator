# Phase 12: Improve Transcription Timeline Accuracy - Research

**Researched:** 2026-03-30
**Domain:** Audio-video timeline synchronization in automated dubbing
**Confidence:** HIGH

## Summary

The translated video's dubbed speech ends significantly before the original video because of three compounding problems in the current pipeline: (1) CosyVoice TTS consistently generates audio shorter than the original segment duration, (2) the gap-aware pacing logic introduced in Phase 11 sometimes skips time-stretching when it should not, and (3) the `mixAudioAbsolute` function places each segment at its original start time but does not verify that segments actually fill their expected duration slots, allowing cumulative shortfall to propagate as perceived "early ending."

The fix is a tighter synthesize loop that always ensures each TTS segment is stretched/padded to match its target duration slot, combined with diagnostic logging to trace exactly where time is being lost. No new external libraries are needed -- the existing FFmpeg `timeStretchExact` and `mixAudioAbsolute` functions are architecturally sound but the orchestration logic in `stepSynthesize` has gaps in its duration-enforcement path.

**Primary recommendation:** Rewrite the gap-aware pacing decision tree in `stepSynthesize` to always enforce segment duration matching (stretch or pad to target), add per-segment duration logging, and add a post-synthesis timeline validation step that compares total synthesized audio duration against source video duration before merging.

## Architecture Patterns

### Current Timestamp Flow (Trace)

```
AssemblyAI utterances
  -> segments[].start/end (ms) -- ACCURATE to ~400ms
    -> openaiService.translateSegments() -- PRESERVES start/end unchanged
      -> stepSynthesize() iterates segments
        -> cosyvoice.synthesize(text, ref, src, tgt, 1.0)
          -> Returns WAV buffer (VARIABLE duration, often SHORTER than target)
        -> Gap-aware pacing decision:
           IF gap exists AND tts fits in (segment + gap): USE AS-IS (no stretch)
           ELSE IF close enough (<0.1s diff): USE AS-IS
           ELSE: timeStretchExact(tts, segDuration) with 0.7x-1.5x clamp
        -> audioParts.push({ path, startMs: seg.start })
      -> mixAudioAbsolute(audioParts, output, videoDurationSec)
        -> adelay positions each segment at absolute startMs
        -> amix combines all with silent base track
```

### Root Cause Analysis

**Root Cause 1: TTS Duration Shortfall (PRIMARY)**

CosyVoice synthesizes at `speed=1.0` (per D-15), but different languages have different information density. A 5-second English segment translated to French may produce only 3 seconds of French TTS because French conveys the same meaning in fewer syllables at natural speaking rate. The gap-aware logic (D-16) then allows this 3s audio to "overflow into the gap" without stretching, meaning 2 seconds of silence appear where speech should be.

Evidence from code (`pipeline.server.ts` lines 988-1008):
```typescript
if (gapSec > 0 && actualGeneratedSec <= segDurationSec + gapSec) {
  // There IS a gap and generated audio fits within segment + gap
  // Use as-is -- natural overflow into gap (no stretching needed)
  audioParts.push({ path: rawPath, startMs: seg.start });
}
```
This condition is too permissive. If `actualGeneratedSec` is 3s and `segDurationSec + gapSec` is 8s, the audio is placed at `seg.start` but only occupies 3s, leaving 5s of silence before the next segment starts at its own `startMs`. The mixAudioAbsolute approach places each segment independently at its start time, so this silence is the GAP -- which is correct architecturally but means SHORT TTS output is never compensated.

**Root Cause 2: No Duration Enforcement When "Fitting in Gap"**

The D-16 gap-aware logic was designed to avoid unnecessary stretching when TTS naturally overflows a little into the gap. But it has no MINIMUM duration check. It should at least ensure the TTS output covers the original segment duration (not just fits within segment+gap).

**Root Cause 3: No Post-Synthesis Duration Validation**

After `mixAudioAbsolute`, the synthesized audio duration is logged but never compared against the source video duration. If the last segment ends at 120s but the audio file is only 80s long (because segments were short), this is not caught until the merge quality check, which has a generous +/-2s tolerance on the video duration (not the audio content).

### Recommended Fix Architecture

```
stepSynthesize (revised):
  For each segment:
    1. Generate TTS -> rawDuration
    2. Calculate targetDuration = segDurationSec (not segment+gap)
    3. Decision tree:
       IF rawDuration >= targetDuration * 0.9 AND rawDuration <= targetDuration * 1.1:
         -> Use as-is (within 10% tolerance)
       ELSE IF rawDuration < targetDuration:
         -> timeStretchExact(raw, targetDuration) -- slow down to fill slot
       ELSE IF rawDuration > targetDuration:
         -> Check gap: if rawDuration <= targetDuration + gapSec:
              -> Use as-is (natural overflow into gap)
            ELSE:
              -> timeStretchExact(raw, targetDuration) -- speed up to fit
    4. Log: segment[i] target={targetDuration}s actual={rawDuration}s final={finalDuration}s

  After all segments:
    5. Compute expected last segment end time (max of all seg.end values)
    6. Compare with synthesized audio actual duration
    7. Log timeline summary: "Last speech at {X}s, video ends at {Y}s, delta={Z}s"
```

### Anti-Patterns to Avoid

- **Over-stretching short TTS**: If TTS generates 1.5s for a 5s segment, stretching to 5s (ratio 0.3x) produces unintelligible slow speech. The 0.7x clamp in `timeStretchExact` already prevents this, but the fallback (pad with silence) means the segment ends with dead air. Better to accept the shorter duration with a brief pad than to distort speech.

- **Adjusting TTS speed parameter**: Per D-15, CosyVoice `speed` parameter should remain at 1.0. Speed adjustments at synthesis time produce worse voice quality than post-synthesis time-stretching.

- **Re-translating for length matching**: While professional dubbing uses "length-aware translation" (adjusting translation to match source timing), this adds significant complexity and GPT latency. Better to handle duration mismatch post-synthesis for the MVP.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Forced alignment for timestamps | Custom phoneme aligner | AssemblyAI utterances (already used) | AssemblyAI timestamps are accurate to ~400ms, sufficient for segment-level dubbing |
| Audio time-stretching | Custom resampling | FFmpeg atempo filter chain (already used via `timeStretchExact`) | Battle-tested, handles ratio chaining automatically |
| Segment positioning | Sequential concatenation | FFmpeg adelay+amix (already used via `mixAudioAbsolute`) | Positions segments at absolute timestamps, avoids cascading drift |
| Duration-aware translation | Custom prompt engineering for length | Post-synthesis stretching | Simpler, already works, avoids doubling translation latency |

## Common Pitfalls

### Pitfall 1: Gap-Aware Logic Allowing Extreme Duration Shortfall
**What goes wrong:** TTS generates 2s for a 6s segment. Gap is 4s. Code says "2s <= 6s + 4s = 10s, fits in gap, use as-is." Result: 4 seconds of silence in the middle of speech.
**Why it happens:** The D-16 gap-aware condition checks if TTS fits within (segment + gap) but doesn't check if TTS covers the segment itself.
**How to avoid:** Add minimum duration check: TTS must be at least `segDuration * 0.7` before the gap-overflow path is taken. Otherwise, stretch to fill segment duration.
**Warning signs:** Log output showing "segment at 45.0s, duration 1.8s" when the original segment was 5s.

### Pitfall 2: timeStretchExact Clamping Creates Silent Padding
**What goes wrong:** When the stretch ratio falls outside 0.7x-1.5x, `timeStretchExact` clamps the ratio and then pads with silence to reach exact target duration. This silence mid-segment sounds like a freeze.
**Why it happens:** The 0.7x-1.5x range is correct for avoiding distortion, but the apad fallback creates unnatural silence.
**How to avoid:** When padding is needed (TTS much shorter than target), add a fade-out on the speech and accept the shorter duration rather than padding with silence. The adelay+amix approach will naturally leave silence until the next segment.
**Warning signs:** `timeStretchExact` log showing "ratio clamped" warnings.

### Pitfall 3: Sample Rate Mismatch in mixAudioAbsolute
**What goes wrong:** CosyVoice outputs WAV at 22050Hz or 24000Hz. The anullsrc base track and other segments may be at 44100Hz. FFmpeg's amix filter resamples automatically, but the adelay values are in milliseconds (sample-rate independent), so this should not cause drift.
**Why it happens:** Not actually a drift source -- FFmpeg handles this correctly. But it can cause confusing debug output if durations don't match expectations due to resampling overhead.
**How to avoid:** Already handled. The `-ar 44100` flag on the amix output normalizes everything.
**Warning signs:** None expected -- this is a non-issue in the current architecture.

### Pitfall 4: Last Segment Timing vs Video Duration
**What goes wrong:** The last transcribed segment might end at 180s in a 300s video (e.g., credits roll with no speech). The synthesized audio correctly ends at ~180s, but this looks like "speech ends too early" to the user.
**Why it happens:** Legitimate -- there is no speech in the last 120s of the video. The background audio (if enabled) fills this gap.
**How to avoid:** In the post-synthesis validation, compare against the last segment's end time, not the video duration. Log both values for diagnostics.
**Warning signs:** Large delta between last segment end time and video duration.

### Pitfall 5: Utterance Boundary vs Word Boundary Timestamps
**What goes wrong:** AssemblyAI utterances group words by speaker turns. A single utterance can be 30+ seconds long for a monologue. The segment start/end from utterances are accurate, but very long segments cause TTS issues (CosyVoice may truncate or produce artifacts on very long text inputs).
**Why it happens:** Utterance-level grouping prioritizes speaker attribution over segment length.
**How to avoid:** Add a segment splitting step: if any translated segment is longer than ~15 seconds of original duration, split it at sentence boundaries within the segment, preserving proportional timing for each sub-segment.
**Warning signs:** Segments with `dur > 15s` in the synthesis log, especially when TTS output is much shorter than expected.

## Code Examples

### Fix 1: Revised Gap-Aware Pacing Decision

```typescript
// In stepSynthesize, replace the current gap-aware block:

const targetDurationSec = segDurationSec; // Always target the segment duration
const tolerance = 0.10; // 10% tolerance

if (Math.abs(actualGeneratedSec - targetDurationSec) / targetDurationSec < tolerance) {
  // Within 10% of target -- use as-is
  audioParts.push({ path: rawPath, startMs: seg.start });
  console.log(
    `[pipeline] Seg ${i}: target=${targetDurationSec.toFixed(2)}s ` +
    `actual=${actualGeneratedSec.toFixed(2)}s -- within tolerance, using as-is`
  );
} else if (actualGeneratedSec > targetDurationSec) {
  // TTS is LONGER than segment
  const gapSec = (nextSegStart - seg.end) / 1000;
  if (gapSec > 0 && actualGeneratedSec <= targetDurationSec + gapSec * 0.8) {
    // Fits within segment + 80% of gap -- allow natural overflow
    audioParts.push({ path: rawPath, startMs: seg.start });
    console.log(
      `[pipeline] Seg ${i}: overflow into gap ` +
      `(${actualGeneratedSec.toFixed(2)}s into ${targetDurationSec.toFixed(2)}s + ${gapSec.toFixed(2)}s gap)`
    );
  } else {
    // Speed up to fit in segment
    const { outputPath: finalPath } = await ffmpeg.timeStretchExact(
      rawPath, targetDurationSec, stretchedPath
    );
    audioParts.push({ path: finalPath, startMs: seg.start });
  }
} else {
  // TTS is SHORTER than segment -- stretch to fill
  const { outputPath: finalPath } = await ffmpeg.timeStretchExact(
    rawPath, targetDurationSec, stretchedPath
  );
  audioParts.push({ path: finalPath, startMs: seg.start });
  console.log(
    `[pipeline] Seg ${i}: stretched ${actualGeneratedSec.toFixed(2)}s -> ${targetDurationSec.toFixed(2)}s`
  );
}
```

### Fix 2: Post-Synthesis Timeline Validation

```typescript
// After mixAudioAbsolute, before upload:

const synthDuration = await ffmpeg.getDuration(synthesizedPath);
const lastSegEndMs = Math.max(...segments.map(s => s.end));
const lastSegEndSec = lastSegEndMs / 1000;
const videoDurationSec = translation.video.durationSec ?? 0;

console.log(
  `[pipeline] Timeline validation:\n` +
  `  Synthesized audio duration: ${synthDuration.toFixed(1)}s\n` +
  `  Last segment ends at:       ${lastSegEndSec.toFixed(1)}s\n` +
  `  Video duration:             ${videoDurationSec.toFixed(1)}s\n` +
  `  Speech coverage:            ${((lastSegEndSec / videoDurationSec) * 100).toFixed(0)}% of video`
);

if (synthDuration < lastSegEndSec * 0.8) {
  console.warn(
    `[pipeline] WARNING: Synthesized audio (${synthDuration.toFixed(1)}s) is significantly ` +
    `shorter than last segment end (${lastSegEndSec.toFixed(1)}s) -- timing drift detected`
  );
}
```

### Fix 3: Long Segment Splitting

```typescript
// Before synthesis loop, split segments longer than MAX_SEGMENT_SEC:

const MAX_SEGMENT_SEC = 15;

function splitLongSegments(
  segments: TranslatedSegment[]
): TranslatedSegment[] {
  const result: TranslatedSegment[] = [];
  for (const seg of segments) {
    const durationSec = (seg.end - seg.start) / 1000;
    if (durationSec <= MAX_SEGMENT_SEC) {
      result.push(seg);
      continue;
    }
    // Split at sentence boundaries
    const sentences = seg.translatedText.split(/(?<=[.!?])\s+/);
    if (sentences.length <= 1) {
      result.push(seg); // Can't split further
      continue;
    }
    const totalChars = seg.translatedText.length;
    let charOffset = 0;
    for (const sentence of sentences) {
      const fraction = sentence.length / totalChars;
      const subStart = seg.start + charOffset / totalChars * (seg.end - seg.start);
      const subEnd = subStart + fraction * (seg.end - seg.start);
      result.push({
        ...seg,
        translatedText: sentence,
        start: Math.round(subStart),
        end: Math.round(subEnd),
      });
      charOffset += sentence.length;
    }
  }
  return result;
}
```

### Fix 4: Improved timeStretchExact for Short TTS

```typescript
// In timeStretchExact, when padding is needed (TTS much shorter than target),
// don't pad with silence. Instead, return the stretched audio at its actual
// length and let mixAudioAbsolute handle the gap naturally.

// Replace the apad block:
} else {
  // Audio is shorter than target after stretching.
  // DON'T pad with silence -- let mixAudioAbsolute handle the natural gap.
  // Just add a gentle fade-out at the end.
  const fadeStart = Math.max(0, actualDuration - 0.1);
  await new Promise<void>((resolve, reject) => {
    Ffmpeg(stretchedTmp)
      .audioFilters(`afade=t=out:st=${fadeStart.toFixed(3)}:d=0.1`)
      .audioChannels(1)
      .audioFrequency(44100)
      .format("wav")
      .on("error", (err) => reject(new Error(`FFmpeg fade failed: ${err.message}`)))
      .on("end", () => {
        if (fs.existsSync(stretchedTmp)) fs.unlinkSync(stretchedTmp);
        resolve();
      })
      .save(outputPath);
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fixed `avgCharsPerSec=14` speed estimation | speed=1.0 + gap-aware stretching | Phase 11 (D-15, D-16, D-19) | Eliminated chipmunk artifacts but introduced duration shortfall |
| Sequential concatenation | adelay+amix absolute positioning | Phase 11 (D-18) | Fixed cascading drift but does not enforce per-segment duration |
| 0.4x-2.5x stretch range | 0.7x-1.5x clamp + pad | Phase 11 (D-17) | Better sound quality but padding creates silence gaps |

**What changed in Phase 11 that created this problem:**
Phase 11 correctly removed the broken `prosodySpeed` estimation but replaced it with gap-aware logic (D-16) that is too permissive about allowing short TTS segments. The absolute positioning approach (D-18) is architecturally correct but exposes the TTS duration shortfall as visible gaps rather than cascading drift.

## Open Questions

1. **How short is CosyVoice TTS output relative to target segment duration?**
   - What we know: CosyVoice at speed=1.0 generates at "natural" pace. Different languages have different information density.
   - What's unclear: Average ratio of TTS duration to target segment duration across language pairs.
   - Recommendation: Add detailed per-segment logging (target vs actual duration) to the first production job after this fix, then analyze the distribution. If TTS is consistently 30-50% shorter, consider using the CosyVoice `speed` parameter at 0.8 (slightly slower) despite D-15.

2. **Should long utterances be split before or after translation?**
   - What we know: Splitting after translation risks breaking sentence meaning. Splitting before gives GPT shorter segments.
   - What's unclear: Whether splitting a 30s utterance into 3x10s segments before translation produces better timing alignment.
   - Recommendation: Split after translation at sentence boundaries (as shown in code example). This preserves translation quality while improving TTS segment length.

3. **Is the AssemblyAI utterance timestamp accuracy sufficient?**
   - What we know: AssemblyAI word-level timestamps are accurate to ~400ms. Utterance boundaries inherit this accuracy.
   - What's unclear: Whether 400ms accuracy matters for segment-level dubbing (it likely does not -- 400ms is acceptable for dubbing where exact lip sync is not attempted).
   - Recommendation: AssemblyAI timestamps are sufficient. The drift problem is not caused by transcription timestamp inaccuracy but by TTS duration shortfall. No need to switch to WhisperX or forced alignment tools.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `app/services/pipeline.server.ts` (stepSynthesize, gap-aware logic at lines 988-1008)
- Codebase analysis: `app/services/ffmpeg.server.ts` (timeStretchExact, mixAudioAbsolute)
- Codebase analysis: `app/services/cosyvoice.server.ts` (synthesize always at speed=1.0)
- Phase 11 RESEARCH.md and CONTEXT.md (D-15 through D-22 decisions)
- [AssemblyAI Word-Level Timestamps Documentation](https://assemblyai.com/docs/pre-recorded-audio/word-level-timestamps) - timestamp accuracy

### Secondary (MEDIUM confidence)
- [Amazon Science: Duration Modeling of Neural TTS for Automatic Dubbing](https://www.amazon.science/publications/duration-modeling-of-neural-tts-for-automatic-dubbing) - isochrony requirement
- [pyVideoTrans: Audio-Subtitles-Video Sync](https://pyvideotrans.com/blog/audio-subtitles-video-sync) - gap absorption strategy
- [FFmpeg adelay+amix sync issues](https://forum.videohelp.com/threads/400516-Audio-out-of-sync-when-using-ffmpeg-adelay-and-amix) - known amix sync problems
- [EMNLP 2025: End-to-End Multilingual Automatic Dubbing via Duration-Alignment](https://aclanthology.org/2025.emnlp-demos.37.pdf) - duration-aligned dubbing approaches

### Tertiary (LOW confidence)
- [CosyVoice 3 paper](https://arxiv.org/pdf/2505.17589) - frame rate mismatch fixes in v3

## Metadata

**Confidence breakdown:**
- Root cause analysis: HIGH - directly traced through codebase, gap-aware logic demonstrably too permissive
- Fix approach: HIGH - uses existing FFmpeg tooling, no new dependencies, surgical code changes
- TTS duration shortfall claim: MEDIUM - inferred from architecture and language density differences, needs production logging to confirm exact ratios
- Pitfalls: HIGH - documented from real FFmpeg behavior and Phase 11 implementation experience

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable domain, no rapidly changing dependencies)
