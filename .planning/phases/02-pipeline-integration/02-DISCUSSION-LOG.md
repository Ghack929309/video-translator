# Phase 2: Pipeline Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-26
**Phase:** 2-Pipeline Integration
**Areas discussed:** TTS Abstraction Pattern, CLONE_VOICE Behavior, Speaker Reference Storage

---

## TTS Abstraction Pattern

| Option | Description | Selected |
|--------|-------------|----------|
| If/else branching | Add engine checks in stepCloneVoice() and stepSynthesize() directly | ✓ |
| Strategy pattern | Create tts-engine.server.ts with TtsEngine interface + 2 implementations | |

**User's choice:** If/else branching (recommended)
**Notes:** Only 2 engines, strategy pattern is overkill for a binary fork. All logic visible in one file.

---

## CLONE_VOICE Step for CosyVoice

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse step 5 | CosyVoice runs step 5 to extract per-speaker reference WAVs, reuses existing speaker detection code | ✓ |
| Skip step 5 | Extract speaker reference audio inline during step 6 synthesis calls | |

**User's choice:** Reuse step 5 (recommended)
**Notes:** Reuses 80% of existing code. Keeps 7-step pipeline consistent. CosyVoice extracts WAVs instead of creating Fish Audio models.

---

## Speaker Reference Storage

| Option | Description | Selected |
|--------|-------------|----------|
| Temp dir only | Store in /tmp/dubly/{id}/, re-extract on resume | ✓ |
| Upload to Tigris | Store per-speaker WAVs in object storage for crash resilience | |

**User's choice:** Temp dir only (recommended)
**Notes:** Extraction is cheap (FFmpeg ops on cached audio). No need for Tigris overhead.

---

## Agent's Discretion

- Exact branching structure within step methods
- Source language detection approach
- Rate limiting for CosyVoice API
- Error message wording

## Deferred Ideas

None — discussion stayed within phase scope
