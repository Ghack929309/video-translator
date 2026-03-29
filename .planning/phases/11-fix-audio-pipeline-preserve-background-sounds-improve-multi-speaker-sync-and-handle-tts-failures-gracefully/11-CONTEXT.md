# Phase 11: Fix audio pipeline — preserve background sounds, improve multi-speaker sync, and handle TTS failures gracefully - Context

**Gathered:** 2026-03-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Overhaul the audio pipeline to: (1) preserve background audio (music, ambient sounds, traffic, etc.) in the final output video instead of stripping all non-speech audio, (2) fix audio/video timing synchronization — especially with multiple speakers — so translated speech matches the pacing of the original, (3) make TTS failures non-catastrophic by adding robust retry logic, pod restart detection, and graceful degradation instead of producing silent/broken output.

</domain>

<decisions>
## Implementation Decisions

### Background Audio Preservation
- **D-01:** Use Demucs (Meta/Facebook) AI-based source separation with the `htdemucs` model variant to separate vocals from background audio. Higher quality than FFmpeg filter-based approaches.
- **D-02:** Demucs runs on the same RunPod pod as CosyVoice (GPU-accelerated). Add a separate `POST /separate` endpoint on the CosyVoice FastAPI server that accepts audio, runs Demucs, and returns separated vocals + background tracks.
- **D-03:** Extract background from the original video's audio stream (highest quality, pre-downsampling), not from the already-extracted 16kHz mono WAV.
- **D-04:** Add a new pipeline step `SEPARATE_AUDIO` between EXTRACT_AUDIO and TRANSCRIBE. Independent idempotency, cleaner separation of concerns.
- **D-05:** Re-separate background audio each time (no caching across translations of the same video). Simpler pipeline.
- **D-06:** Background audio ducking is a simple on/off toggle in the UI (default: on, -8dB during speech). Not a slider or multi-level control.
- **D-07:** If background extraction fails or produces garbage, fall back silently to speech-only (current behavior). Don't block the pipeline over background audio.

### TTS Failure Handling
- **D-08:** Add a lightweight `GET /health` endpoint to the CosyVoice FastAPI server that returns `{"ready": true}` only after the model is fully loaded and warmup inference completes. Used by the pipeline and also serves the Demucs endpoint readiness.
- **D-09:** Before SYNTHESIZE step, perform a health check by polling the `/health` endpoint. Wait up to 3 minutes for the pod to be ready. This catches pod restarts (observed: model re-download + warmup takes ~10s).
- **D-10:** When TTS fails mid-process after previously succeeding (pod restart detected), pause the pipeline and wait for pod recovery by polling `/health`. Resume from the failed segment. These recovery waits don't count as segment-level retries.
- **D-11:** Per-segment retry strategy: 5 retries with exponential backoff (2s, 4s, 8s, 16s, 30s). Total wait ~60s per segment.
- **D-12:** When ALL retries fail for a segment, fall back to silence for that segment. Continue processing remaining segments.
- **D-13:** Track failed segments in the DB — store a list of failed segment indices + error reasons on the Translation record. Surface in the UI: "Warning: X of Y segments could not be synthesized."
- **D-14:** If >50% of segments fail TTS, abort the entire job and mark as FAILED. A translation with mostly silence is not useful.

### Multi-Speaker Sync & Pacing
- **D-15:** Always synthesize at CosyVoice speed=1.0 (natural speed). Do NOT use the CosyVoice speed parameter for pacing. All pacing adjustments happen post-synthesis with FFmpeg.
- **D-16:** After synthesis, check if there's a silence gap between the current segment's end and the next segment's start. If there IS a gap, allow the synthesized speech to naturally overflow into it (no stretching needed). If there's NO gap, apply FFmpeg atempo stretch to fit within the segment boundary.
- **D-17:** Tighter stretch limits: 0.7x–1.5x (down from 0.4x–2.5x). More natural sound. If the target is outside this range, truncate with fade-out at the segment boundary.
- **D-18:** Layer overlapping segments from different speakers — use the existing amix absolute position approach. Don't try to prevent overlap; let the audio mix naturally as it would in conversation.
- **D-19:** Remove the fixed `avgCharsPerSec = 14` constant and the `prosodySpeed` calculation. These are no longer needed since we're synthesizing at natural speed and handling pacing via gap detection + selective stretching.

### Merge Strategy
- **D-20:** Pre-mix audio approach: first use FFmpeg amix to combine synthesized speech + ducked background into one audio track. Then replace the video's audio with this pre-mixed track. Two FFmpeg passes but cleaner control over ducking levels.
- **D-21:** Copy video codec (`-c:v copy`), encode only the new mixed audio to AAC. No quality loss on video, fast processing.
- **D-22:** Add a quality check after merge: verify output duration matches input (±2s), audio stream exists and is >1KB, file size is reasonable. Catches silent/corrupt outputs before they reach users.
- **D-23:** Keep intermediate files (background track, pre-ducked mix) in `/tmp/dubly/{id}/` during processing for debugging. Clean up on success via existing `ffmpeg.cleanup()`.

### Claude's Discretion
- Exact Demucs API request/response format
- Ducking implementation details (sidechain compression vs simple volume reduction)
- How to detect "garbage" background extraction (heuristic for mostly-silence output)
- Exact quality check thresholds (file size bounds, duration tolerance)
- Pipeline step ordering for the new SEPARATE_AUDIO step (enum update, progress percentages)
- Schema changes needed for tracking failed segments and ducking preference

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Pipeline Code (Primary Modification Targets)
- `app/services/pipeline.server.ts` — Full pipeline orchestrator. Key areas:
  - Lines 687–900: `stepSynthesize()` — TTS generation, pacing logic, retry handling (all changing)
  - Lines 907–1001: `stepMerge()` — Video/audio mux (needs background mixing)
  - Lines 797–863: Segment loop with `prosodySpeed`, `hardLimitSec`, silent fallback (rewriting)
  - Lines 140–153: Step function array (adding SEPARATE_AUDIO step)
- `app/services/ffmpeg.server.ts` — All FFmpeg operations:
  - `extractAudio()` — Currently extracts mono 16kHz (needs full-quality extraction for separation)
  - `mergeAudioVideo()` — Currently simple mux (needs background mixing)
  - `mixAudioAbsolute()` — Absolute position mixing (reuse for final mix)
  - `timeStretchExact()` — Stretch limits changing from 0.4-2.5 to 0.7-1.5
- `app/services/cosyvoice.server.ts` — CosyVoice TTS client:
  - Retry logic (lines 116-173) — Changing from 3 retries/1-2s to 5 retries/exponential
  - `synthesize()` — Remove prosody speed manipulation, always speed=1.0

### CosyVoice FastAPI Server (API Changes)
- `services/cosyvoice-api/server.py` — FastAPI server. Adding:
  - `GET /health` endpoint (model readiness check)
  - `POST /separate` endpoint (Demucs source separation)
  - Demucs model loading alongside CosyVoice

### Schema
- `prisma/schema.prisma` — Translation model needs:
  - Failed segments tracking field
  - Background audio ducking preference
  - New PipelineStep enum value (SEPARATE_AUDIO)

### Phase 2 Context (Pipeline Integration Decisions)
- `.planning/phases/02-pipeline-integration/02-CONTEXT.md` — CosyVoice pipeline integration patterns

### Phase 10 Context (Prior Sync/Pacing Work)
- `.planning/phases/10-enhance-voice-cloning-synthesis-and-merge-synchronization/09-CONTEXT.md` — Previous attempt at fixing sync issues

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ffmpeg.mixAudioAbsolute()` — Already handles absolute position mixing with adelay filters. Can be reused for the final speech+background pre-mix.
- `ffmpeg.timeStretchExact()` — Has clamp logic and fade-out truncation. Needs limits changed but core logic is solid.
- `ffmpeg.generateSilence()` — Used for padding. Still needed.
- `runpodApi.waitForPodReady()` — Already exists for pod startup. Can be adapted for health check polling.

### Established Patterns
- Idempotency: each step checks for existing output before re-executing
- Progress updates: proportional to work done, batched every 5 segments
- Console logging: `[pipeline]`, `[ffmpeg]`, `[cosyvoice]` prefixes
- Error handling: catch per-segment, update DB with error state
- RunPod pod lifecycle: startPod before SYNTHESIZE, stopPod in finally block

### Integration Points
- `ORDERED_STEPS` array in pipeline.server.ts — needs SEPARATE_AUDIO added
- `STEP_PROGRESS` map — needs progress values rebalanced for 8 steps
- `PipelineStep` type + Prisma enum — needs SEPARATE_AUDIO added
- New translation form — needs ducking toggle (simple checkbox)
- Translation detail page — needs failed segment warning display
- CosyVoice FastAPI Docker image — needs Demucs pip dependency + model download

</code_context>

<specifics>
## Specific Ideas

- The RunPod pod log shows the CosyVoice server re-downloading models mid-process from modelscope.cn, causing ~10s downtime. The health endpoint must only return ready AFTER warmup inference completes.
- A 2-minute video with 3 TTS segments was getting only the first 5 seconds translated — the remaining segments all failed with IN_QUEUE and were silently dropped. This is the critical bug.
- "Netflix level" quality target: professional dubbing preserves ambient audio, matches lip sync timing, and never produces silent gaps.
- For background ducking: -8dB during speech is the standard for broadcast dubbing.
- The same RunPod pod runs both CosyVoice and Demucs — no need for separate infrastructure.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-fix-audio-pipeline-preserve-background-sounds-improve-multi-speaker-sync-and-handle-tts-failures-gracefully*
*Context gathered: 2026-03-29*
