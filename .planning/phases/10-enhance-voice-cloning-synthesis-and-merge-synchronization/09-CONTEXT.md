# Phase 10: Enhance voice cloning, synthesis, and merge synchronization - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning
**Source:** User Issue Report

## Explicit Constraints

The audio engine's final rendering layers (Voice Cloning, TTS Synthesize, and Video Merge) are producing severely degraded outputs. We must fundamentally overhaul these loops.

**Reported Symptoms:**
1. **Audio Speed Matching Mismatch:** Output audio is pacing aggressively (too fast or too slow), rendering it completely unnatural and barely listenable.
2. **Poor Voice Prescriptions:** The Voice Cloning embeddings are degraded or mismatched, losing the original accent/timbre fidelity completely.
3. **Severe Video Synchronization Desync:** The `MERGE` step produces audio that significantly lags or preempts lip movements inside the MP4 container.
4. **Bizarre Language Reversions:** Segments spontaneously abandon the translated target language, synthesizing audio *in the original source language natively* via cross-lingual glitching.

**Required Action:**
- Investigate `ffmpeg.server.ts` time-stretching thresholds/rubberband parameters that might be mutilating pitch/speed.
- Check the `stepSynthesize` loop in `pipeline.server.ts` to ensure CosyVoice/Fish Audio `prosody_speed` or speed constraints correctly evaluate character densities.
- Debug the Language selection variables injected during API requests (the cross-lingual zero-shot instruction text needs strict isolation).
- Evaluate timestamp alignment between `start/end` metrics captured by AssemblyAI vs expected ffmpeg `MERGE` gaps.
