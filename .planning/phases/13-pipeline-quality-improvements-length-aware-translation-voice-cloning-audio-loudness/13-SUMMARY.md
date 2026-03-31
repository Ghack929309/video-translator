# Phase 13 — Pipeline Quality Improvements: Summary

## Overview
Three major improvements to bring dubbing quality closer to professional standards (Netflix/Amazon/Disney):
1. **Length-aware translation** via GPT prompt engineering
2. **Voice cloning accent fix** using high-quality vocals audio + longer references
3. **Professional loudness normalization** with EBU R128 + dynamic sidechain ducking

All changes compile cleanly (`tsc --noEmit` passes).

---

## Changes by File

### `prisma/schema.prisma`
- Added `vocalsAudioKey String?` — stores Tigris key for Demucs-separated vocals track
- Added `loudnessProfile String @default("WEB")` — configurable per-translation loudness target (`WEB`/`STREAMING`/`BROADCAST`)

### `app/services/openai.server.ts`
- **Added `CHARS_PER_SECOND` map** — language-specific speaking rates (e.g., English 14 cps, Chinese 6 cps, Japanese 8 cps)
- **Modified `callTranslationAPI`** — each segment now includes a target character count computed from `duration × charsPerSecond`:
  ```
  [0] (target: ~42 chars, 3.0s) Hello, welcome to the show today.
  ```
- **Updated system prompt** — added `LENGTH MATCHING (CRITICAL FOR DUBBING)` section instructing GPT to stay within ±15% of target character count
- **Added post-translation length validation** — logs warnings for segments >20% off target

### `app/services/pipeline.server.ts`

#### `stepSeparateAudio` (lines 562-605)
- Now saves **both** `background` and `vocals` tracks from Demucs
- Uploads vocals to Tigris at `translations/{id}/vocals-audio.wav`
- Stores `vocalsAudioKey` on the translation record

#### `stepCloneVoice` (lines 804-1020)
- **Uses high-quality vocals audio** (44.1kHz, Demucs-separated) instead of 16kHz mono ASR audio
- Falls back to extractedAudio if vocals unavailable
- **Enforces 5s minimum reference** (up from 0.5s) with 1.5s absolute minimum
- **Concatenation fallback** — if no single segment ≥ 5s, concatenates top segments sorted by duration × confidence
- **Smart ranking** — prefers segments ≥ 5s, then by duration, then by word-level confidence score
- Uses `ffmpeg.concatenateWithGaps()` for multi-segment references

#### `stepSynthesize` (lines 1238-1287)
- **Carrier phrase padding** for short segments (< 12 chars, CosyVoice only)
- Appends a natural filler sentence in the target language to give the model more phonological context
- Trims the carrier audio off after synthesis using proportional duration estimation
- Carrier phrases provided for 12 languages

#### `stepMerge` (lines 1487-1534)
- **Replaced flat -8dB ducking** with dynamic sidechain ducking via `ffmpeg.sidechainDuck()`
- Background is compressed only when speech is present — plays at near-original level during gaps
- Falls back to flat -5dB ducking if sidechain fails
- **Added EBU R128 loudness normalization** using the translation's `loudnessProfile`
- Falls back to unnormalized audio if normalization fails

### `app/services/ffmpeg.server.ts`

#### New: `concatenateWithGaps()` (lines 362-424)
- Concatenates multiple WAV files with configurable silence gaps
- Uses FFmpeg `concat` filter with per-input format normalization

#### New: `LOUDNESS_PROFILES` (lines 788-792)
- Preset targets: `WEB` (-14 LUFS), `STREAMING` (-24 LUFS), `BROADCAST` (-27 LKFS)

#### New: `measureLoudness()` (lines 798-848)
- EBU R128 first-pass measurement via FFmpeg `loudnorm` filter
- Returns integrated LUFS, loudness range, true peak, and threshold

#### New: `normalizeLoudness()` (lines 857-909)
- Two-pass EBU R128 normalization for precise LUFS targeting
- Accepts profile name or custom `{targetI, targetLRA, targetTP}` object

#### New: `sidechainDuck()` (lines 920-978)
- Dynamic sidechain compression: background is ducked when speech signal is present
- Parameters tuned for dubbing: threshold=0.015, ratio=6, attack=200ms, release=1000ms
- Combines ducking and mixing in a single FFmpeg filter_complex pass

---

## Root Causes Addressed

| Problem | Root Cause | Fix |
|---------|-----------|-----|
| Accent bleeding on short segments | 16kHz mono reference audio + 0.5s minimum | 44.1kHz vocals audio + 5s minimum + carrier phrases |
| Translation length mismatch | No concrete length target in GPT prompt | Per-segment character count targets from language-specific speaking rates |
| Unnatural background audio | Flat -8dB ducking everywhere | Dynamic sidechain compression (background full during gaps) |
| No loudness standards | No LUFS measurement or normalization | EBU R128 two-pass normalization with configurable profiles |

## Verification
```
npx tsc --noEmit  # ✅ Passes with 0 errors
npx prisma db push  # ✅ Schema synced
npx prisma generate  # ✅ Client regenerated
```
