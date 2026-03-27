# Pitfalls Research — CosyVoice 3 Integration

## P1: PCM Output Format Mismatch
- **Risk:** CosyVoice returns raw PCM bytes (no WAV header). If treated as WAV, FFmpeg will produce garbage audio.
- **Warning signs:** Output audio is static/noise, FFmpeg errors about invalid format
- **Prevention:** Always wrap PCM response in WAV header (44 bytes) with correct params: 24000 Hz, 1 channel, 16-bit (int16). Validate audio length matches expected duration.
- **Phase:** CosyVoice service module

## P2: Cross-Lingual vs Zero-Shot Mode Confusion
- **Risk:** Using wrong mode — `cross_lingual` requires NO `prompt_text`, `zero_shot` REQUIRES it (with specific prefix). Mixing them up causes silent failures or garbled output.
- **Warning signs:** Empty audio responses, API 400 errors
- **Prevention:** Service module must determine mode from source/target language comparison. Same language = `zero_shot` + transcript prefix. Different language = `cross_lingual` (no transcript).
- **Phase:** CosyVoice service module

## P3: Speaker Reference Audio Quality
- **Risk:** CosyVoice needs 3–10s of clean speech per speaker. If reference is too short, noisy, or contains multiple speakers, voice quality degrades.
- **Warning signs:** Cloned voice doesn't resemble source, robotic output
- **Prevention:** Ensure reference extraction selects the longest clean segments per speaker. Filter segments < 0.5s. Concatenate multiple segments up to 10s max. Avoid segments with detected overlap.
- **Phase:** Pipeline integration (Step 5)

## P4: RunPod Cold Start Impact on Batch Segments
- **Risk:** First request to a cold RunPod worker takes 30–90s. With 50+ segments per translation, only the first request is slow, but it can push total job time significantly.
- **Warning signs:** First segment takes 60s+, subsequent segments are fast (< 2s each)
- **Prevention:** Accepted for now. Future optimization: RunPod warm workers or batch inference. Log timing per segment to benchmark actual cold start impact.
- **Phase:** Monitoring (post-launch)

## P5: Speaker Voice Mix-Up After Diarization
- **Risk:** AssemblyAI assigns speaker labels (A, B, C) but can misattribute segments, especially short ones. The smoothing algorithm fixes some cases but not all. The result: Speaker 1's voice is used for Speaker 2's words.
- **Warning signs:** Output video has wrong voice for certain segments, especially short responses
- **Prevention:**
  1. Use `speakers_expected` parameter when known (from UI or auto-detection)
  2. Increase minimum segment duration threshold in smoothing (skip very short segments)
  3. Consider confidence-weighted speaker assignment
  4. Log speaker assignments for debugging
- **Phase:** Speaker diarization improvements

## P6: Environment Variable Management
- **Risk:** New `COSYVOICE_URL` env var needed. If missing, pipeline crashes at synthesis step.
- **Warning signs:** Zod validation failure on startup (if added to schema), or runtime error when CosyVoice path is taken
- **Prevention:** Add to `env.server.ts` Zod schema with clear error message. Add to `.env.example`. Make optional (only required when CosyVoice is selected as engine).
- **Phase:** Schema/config setup
