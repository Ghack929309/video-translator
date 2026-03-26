# Phase 1: CosyVoice Service & Schema - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-26
**Phase:** 1-CosyVoice Service & Schema
**Areas discussed:** Service Architecture, Error & Retry Strategy, ENV Configuration

---

## Service Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Standalone service | Create `cosyvoice.server.ts` mirroring Fish Audio's pattern, defer TTS abstraction to Phase 2 | ✓ |
| Abstraction now | Build `tts-engine.server.ts` in Phase 1 wrapping both services behind common interface | |

**User's choice:** Standalone service (recommended)
**Notes:** Keeps Phase 1 focused. Abstraction makes more sense in Phase 2 where pipeline integration happens.

---

## Error & Retry Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Size + duration estimation | Validate response > 0 bytes, estimate duration from byte count, flag unreasonable durations, 2 retries with exponential backoff | ✓ |
| Minimal check | Just verify non-empty response, let FFmpeg catch bad audio downstream | |

**User's choice:** Size + duration estimation (recommended)
**Notes:** Mirrors existing Fish Audio validation pattern. Duration formula: `bytes / 2 / 24000 = seconds`.

---

## ENV Configuration

| Option | Description | Selected |
|--------|-------------|----------|
| Optional with runtime check | `COSYVOICE_URL` optional in Zod schema, throws descriptive error only when CosyVoice translation attempted without URL | ✓ |
| Always required | Both Fish Audio and CosyVoice URLs must be set for app to start | |

**User's choice:** Optional with runtime check (recommended)
**Notes:** Fish Audio-only users aren't blocked by missing CosyVoice config.

---

## Agent's Discretion

- PCM-to-WAV header construction details
- Internal method naming and parameter ordering
- Logging format

## Deferred Ideas

None — discussion stayed within phase scope
