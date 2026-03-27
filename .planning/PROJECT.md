# Dubly — Video Translation Platform

## What This Is

A video translation platform that takes a source video (uploaded or from YouTube/Instagram/Facebook/Vimeo), transcribes the audio, translates it to a target language, clones the original speakers' voices, and produces a dubbed output video where each speaker sounds like themselves speaking the target language natively.

## Core Value

The translated video must sound natural — each speaker's voice preserved, speaking the target language without accent bleed from the source language.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ User can upload video files directly to storage — existing
- ✓ User can provide video URLs (YouTube, Instagram, Facebook, Vimeo) for download — existing
- ✓ Audio is extracted from source video and transcribed with word-level timestamps — existing
- ✓ Transcript is translated to 21+ target languages preserving segment timing — existing
- ✓ Speaker diarization detects multiple speakers in source audio — existing
- ✓ Per-speaker voice cloning generates TTS with cloned voices (Fish Audio) — existing
- ✓ Synthesized audio is time-stretched to match original segment durations — existing
- ✓ Final video is produced by merging synthesized audio onto original video — existing
- ✓ Async job queue processes translations in background (pgmq worker) — existing
- ✓ User authentication via Supabase (email/password, OAuth) — existing
- ✓ Admin dashboard for user management and job monitoring — existing
- ✓ Progress tracking with real-time status polling — existing

### Active

<!-- Current scope. Building toward these. -->

- [ ] User can select CosyVoice 3 as TTS engine alongside Fish Audio
- [ ] CosyVoice 3 cross-lingual synthesis for 9 languages (EN, ZH, JA, KO, DE, ES, FR, IT, RU) without accent bleed
- [ ] UI model selector on new translation page — language dropdown dynamically filters based on selected engine
- [ ] Self-hosted CosyVoice 3 inference endpoint on RunPod Serverless (GPU)
- [ ] Per-speaker reference audio sent inline with each CosyVoice synthesis call (no persistent voice models)
- [ ] Stronger speaker diarization to prevent voice mix-ups in multi-speaker output videos
- [ ] CosyVoice service module with cross_lingual and zero_shot modes
- [ ] PCM-to-WAV conversion for CosyVoice raw output (24kHz, mono, int16)

### Out of Scope

- Pronunciation inpainting via CosyVoice bracket notation — future capability
- Removing Fish Audio entirely — keeping as option for languages CosyVoice doesn't cover
- Admin role enforcement fix — separate concern
- Health check endpoint — separate concern
- Test framework setup — separate concern
- Docker Node version alignment — separate concern

## Context

### Current Architecture
Full-stack SSR app (React Router v7 + Vite) deployed on Fly.io with two processes: web server and worker. Worker polls pgmq queue, runs 7-step pipeline (download → extract audio → transcribe → translate → clone voice → synthesize → merge). Storage on Tigris (S3-compatible). Database on Supabase Postgres via Prisma 7.

### The Problem
Fish Audio S1 produces heavy accent bleed — cloned voices speak the target language with the source language's accent. In multi-speaker videos, speaker voice assignments frequently get mixed up (Speaker 1's voice used for Speaker 2's segments and vice versa).

### The Solution
CosyVoice 3 extracts only speaker timbre from reference audio and generates speech using the target language's native phonology. Supervised semantic tokens trained on 1M hours partially disentangle speaker identity from language/accent. Self-hosted on RunPod Serverless (GPU) since no hosted API exists and Fly.io has no GPU machines.

### CosyVoice 3 API Contract
- **Endpoint:** `POST {COSYVOICE_URL}/inference` (multipart/form-data)
- **Fields:** `tts_text` (string), `mode` ("cross_lingual" | "zero_shot"), `stream` ("false"), `speed` (string, 0.5–2.0), `prompt_wav` (file, WAV ≥16kHz mono 3–10s), `prompt_text` (string, zero_shot only, prefixed with `You are a helpful assistant.<|endofprompt|>`)
- **Response:** Raw PCM int16 bytes, 24,000 Hz, mono — must be wrapped in WAV header before FFmpeg processing

## Constraints

- **GPU host**: CosyVoice 3 requires NVIDIA GPU (8GB+ VRAM) — Fly.io has no GPU, RunPod Serverless is the deployment target
- **Cold starts**: RunPod Serverless cold starts (30–90s) acceptable since translation jobs are async
- **Model**: `Fun-CosyVoice3-0.5B-2512`, Apache 2.0 license, 0.5B parameters
- **Languages**: CosyVoice 3 supports 9 languages (EN, ZH, JA, KO, DE, ES, FR, IT, RU); Fish Audio covers the remaining 12

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep Fish Audio alongside CosyVoice 3 | Fish Audio covers 12 languages CosyVoice doesn't; user choice in UI | — Pending |
| Self-host CosyVoice 3 on RunPod Serverless | No hosted API exists; GPU costs ~$4–8/mo vs $16–26/mo Fish Audio; full model control | — Pending |
| Send per-speaker reference audio inline (no persistent models) | CosyVoice 3 doesn't create persistent voice models like Fish Audio; reference audio sent with each call | — Pending |
| Accept RunPod cold starts for now | Jobs are async (worker queue); optimization deferred | — Pending |
| Pronunciation inpainting deferred | Future capability; focus on core cross-lingual synthesis first | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-26 after initialization*
