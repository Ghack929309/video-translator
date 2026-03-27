---
wave: 1
depends_on: []
files_modified: ["app/services/cosyvoice.server.ts", "app/services/pipeline.server.ts", "app/services/ffmpeg.server.ts"]
autonomous: true
---

# Plan: Audio Synchronization & Cloning Overhaul

## Objective
Fix the severe audio degradation issues during TTS generation by injecting explicit language constraints, relying on isolated (non-concatenated) speaker reference samples, and shifting the time-stretching paradigm from "strict exact segment bounds" to "fluid natural pacing with silence consumption."

## Tasks

<task>
<description>
Fix Language Reversion (Inject Target Language Tags)
</description>
<read_first>
- app/services/cosyvoice.server.ts
</read_first>
<action>
In `cosyvoice.server.ts`'s `synthesize` method, the `text` parameter must be explicitly prepended with the target language token for CosyVoice 3.
Modify the payload assignment:
`const final_text = \`<|${targetLanguage}|>\${text}\`;` 
And assign `final_text` to `tts_text` inside `inputPayload`. Note that `FishAudio` doesn't use this, but `cosyvoice.server.ts` is purely CosyVoice. This prevents the LLM from hallucinating cross-lingual references back to the source input language.
</action>
<acceptance_criteria>
- CosyVoice receives `<|es|>Hola mundo` instead of `Hola mundo`, forcing strict pronunciation models.
</acceptance_criteria>
</task>

<task>
<description>
Fix Degraded Voice Clones (Single Continuous Reference)
</description>
<read_first>
- app/services/pipeline.server.ts
</read_first>
<action>
In `pipeline.server.ts` -> `stepCloneVoice`, the current logic loops over multiple segments, extracts them, and concatenates them using FFmpeg. This causes micro-stutter "clicks" in the reference WAV which destroys the embedding quality. 
Rewrite the extraction loop: find the *longest* single continuous segment for the speaker that is at least 3 seconds long. If one exists, `ffmpeg.extractTimeRange` only that single segment (capped at 10s) and use it directly. If no single segment is >3s, fall back to concatenating the top 2 longest segments (with a short crossfade or just raw). 
</action>
<acceptance_criteria>
- Voice references avoid multiple rigid cuts, preserving original clean timbres.
</acceptance_criteria>
</task>

<task>
<description>
Fix Audio Speed Mismatch (Natural Fluid Pacing)
</description>
<read_first>
- app/services/pipeline.server.ts
- app/services/ffmpeg.server.ts
</read_first>
<action>
In `stepSynthesize`, remove the extreme `prosodySpeed` calculation and lock it closer to `1.0` (or remove the hint). 
Instead of forcing FFmpeg `timeStretchExact` to squish the TTS down to exactly `seg.end - seg.start` (which creates chipmunks), we will calculate `availableRoomMs = (nextSegment.start - seg.start)`. 
Wait, the next segment might be from a *different* speaker, but that's fine—audio can't overlap.
`availableRoomSec = availableRoomMs / 1000`.
1. Generate TTS at natural speed.
2. Get the actual length of the generated TTS (`rawPath`).
3. If `actualDuration <= availableRoomSec`, DO NOT STRETCH IT AT ALL. We let it naturally push into the available gap!
4. If `actualDuration > availableRoomSec`, apply gentle `timeStretchExact` to fit exactly `availableRoomSec`.
5. Since we ate into the gap, `runningPositionMs` becomes `seg.start + actualFinalDurationMs`.
This means the preceding `gapMs` generator in the loop must use `seg.start - runningPositionMs`. If `gapMs < 0`, it just continues (next segment starts immediately).
</action>
<acceptance_criteria>
- Audio plays at natural speed and simply consumes adjacent silence gaps instead of distorting to identical physical bounds.
</acceptance_criteria>
</task>

## Verification
- Translate a 1-minute clip: verify the output MP4 has synchronized lips and completely natural speaking cadence without chipmunk artifacts.
- Verify CosyVoice speaks natively with precise language tagging (no sudden shifts to English pronunciations).
