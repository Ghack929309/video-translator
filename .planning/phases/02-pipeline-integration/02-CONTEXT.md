# Phase 2: Pipeline Integration - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire CosyVoice into pipeline steps 5 (CLONE_VOICE) and 6 (SYNTHESIZE) using if/else engine branching in the existing pipeline orchestrator. This phase delivers end-to-end translation using CosyVoice — from speaker reference extraction through time-aligned dubbed output. No TTS abstraction layer (strategy pattern rejected as overkill for 2 engines).

</domain>

<decisions>
## Implementation Decisions

### TTS Abstraction Pattern
- **D-01:** Use if/else branching inside `stepCloneVoice()` and `stepSynthesize()` directly. Check `translation.ttsEngine === 'COSYVOICE'` to fork behavior. No strategy pattern or `tts-engine.server.ts` — only 2 engines, keep all logic visible in one file.

### CLONE_VOICE Step for CosyVoice
- **D-02:** Reuse step 5 for CosyVoice reference extraction. The existing speaker detection + per-speaker audio extraction code stays intact. For CosyVoice: instead of calling `fishAudio.createVoiceModel()`, extract per-speaker reference WAVs (3–10s clean speech) and store their local file paths in a map. Skip the Fish Audio model creation and `trimAndCompress` steps.
- **D-03:** Store extracted speaker WAV paths in a local map (not DB). The voiceMap for CosyVoice contains `{ "A": "/tmp/dubly/{id}/speaker-A-sample.wav", "B": "/tmp/..." }` instead of Fish Audio model IDs.
- **D-04:** The idempotency check for CosyVoice should verify temp files exist (not `fishAudioVoiceMap`). If temp files are missing on resume, re-extract from source audio.

### SYNTHESIZE Step for CosyVoice
- **D-05:** CosyVoice synthesis calls `cosyvoice.synthesize(text, speakerWavPath, sourceLanguage, targetLanguage, speed)` — sending the reference WAV path inline (no model ID). The returned WAV buffer is written to disk, then time-stretched identically to Fish Audio path.
- **D-06:** The same absolute position tracking, silence insertion, time-stretch, and concatenation logic is shared between engines. Only the TTS call differs.
- **D-07:** Source language is needed for CosyVoice mode selection but not currently stored. Read it from the transcript metadata or derive from the video's source content.

### Speaker Reference Storage
- **D-08:** Store extracted per-speaker WAVs in `/tmp/dubly/{translationId}/` only (temp dir). No Tigris upload. If pipeline crashes after step 5, reference audio is re-extracted on resume (extraction is cheap — FFmpeg ops on cached audio).

### Agent's Discretion
- Exact branching structure within step methods
- Source language detection approach (from transcript metadata or AssemblyAI response)
- Rate limiting strategy for CosyVoice (may differ from Fish Audio's 150ms delay)
- Error message wording for CosyVoice-specific failures

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Pipeline Code (Primary Modification Target)
- `app/services/pipeline.server.ts` — 883-line pipeline orchestrator, specifically:
  - Lines 445–589: `stepCloneVoice()` — speaker detection, audio extraction, Fish Audio model creation
  - Lines 597–780: `stepSynthesize()` — TTS generation, time-stretch, absolute position tracking, concatenation
  - Lines 10: `import { fishAudio }` — add CosyVoice import alongside
  - Lines 86–145: `run()` method — step orchestration loop with resume-from-failure

### CosyVoice Service (Phase 1 Output)
- `app/services/cosyvoice.server.ts` — CosyVoice 3 HTTP client with `synthesize()`, `SUPPORTED_LANGUAGES`, PCM→WAV conversion

### Supporting Services
- `app/services/ffmpeg.server.ts` — `extractTimeRange()`, `concatenateAudio()`, `timeStretchExact()`, `generateSilence()`, `getDuration()`
- `app/services/assemblyai.server.ts` — transcription service (source language detection)

### Schema
- `prisma/schema.prisma` — `TtsEngine` enum (FISH_AUDIO, COSYVOICE), `ttsEngine` field on Translation

### Phase 1 Context
- `.planning/phases/01-cosyvoice-service-schema/01-CONTEXT.md` — CosyVoice API contract, mode selection logic

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Speaker detection loop (lines 498–519) — parse transcript, group segments by speaker. Reuse 100% for CosyVoice.
- Per-speaker audio extraction (lines 524–550) — FFmpeg `extractTimeRange()` + `concatenateAudio()`. Reuse for CosyVoice reference WAV extraction.
- Absolute position tracking (lines 652–675) — silence gap calculation. Shared between engines.
- Time-stretch logic (lines 720–736) — `ffmpeg.timeStretchExact()`. Shared between engines.
- TTS fallback to silence (lines 737–748) — error handling. Shared between engines.

### Established Patterns
- Idempotency checks at step start (`if (translation.field) return`)
- Progress updates proportional to work done
- Console logging with `[pipeline]` prefix
- DB field `fishAudioVoiceMap` stores Fish Audio model IDs — CosyVoice uses transient local paths instead

### Integration Points
- `stepCloneVoice()` — fork after speaker audio extraction: Fish Audio creates models, CosyVoice caches WAV paths
- `stepSynthesize()` — fork at TTS call: Fish Audio uses model ID, CosyVoice uses WAV path
- `pipeline.server.ts` line 10 — add `import { cosyvoice }` 
- Idempotency check in step 5 — CosyVoice needs different check (temp WAV existence vs `fishAudioVoiceMap`)

</code_context>

<specifics>
## Specific Ideas

- CosyVoice doesn't need `trimAndCompress` (no upload size limit — reference audio stays local)
- CosyVoice reference audio target: 3–10s of clean speech per speaker (same extraction, skip the MP3 compression)
- Source language: read from AssemblyAI transcript response (`language_code` field) — already available in `transcriptJson`
- For CosyVoice path, `fishAudioVoiceId` and `fishAudioVoiceMap` fields remain null — these are Fish Audio-specific

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-pipeline-integration*
*Context gathered: 2026-03-26*
