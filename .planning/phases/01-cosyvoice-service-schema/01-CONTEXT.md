# Phase 1: CosyVoice Service & Schema - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the CosyVoice 3 HTTP client module (`cosyvoice.server.ts`) and update the Prisma schema to support dual TTS engines. This phase delivers a standalone service that can communicate with a CosyVoice 3 inference endpoint and a database migration that adds the `ttsEngine` field. The TTS engine abstraction layer and pipeline wiring happen in Phase 2.

</domain>

<decisions>
## Implementation Decisions

### Service Architecture
- **D-01:** Create `cosyvoice.server.ts` as a standalone object literal service, mirroring Fish Audio's pattern (`export const cosyvoice = { ... }`). Do NOT build the TTS abstraction layer in this phase — that belongs in Phase 2 (Pipeline Integration).
- **D-02:** Service methods: `synthesize(text, promptWavPath, mode, targetLanguage, speed)` and a helper to convert raw PCM to WAV buffer.

### Error & Retry Strategy
- **D-03:** Validate CosyVoice PCM responses using size + duration estimation: `bytes / 2 / 24000 = seconds`. Flag responses shorter than 0.1s or unreasonably long.
- **D-04:** Retry pattern: 2 retries with exponential backoff (same as Fish Audio: 1s, 2s delays). Log each attempt.
- **D-05:** Validate response is non-empty. No WAV header to check (PCM is raw), so use size-based validation.

### ENV Configuration
- **D-06:** `COSYVOICE_URL` is optional in the Zod schema (`.optional()`). The app boots without it. A descriptive error is thrown only when a CosyVoice translation is attempted without the URL configured.

### Agent's Discretion
- PCM-to-WAV header construction details (44-byte RIFF header with 24kHz, mono, int16 params)
- Internal method naming and parameter ordering
- Logging format (follow existing `[cosyvoice]` prefix convention)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing TTS Service (Pattern Reference)
- `app/services/fish-audio.server.ts` — existing TTS service pattern to mirror (object literal, retry logic, response validation)

### Schema & Config
- `prisma/schema.prisma` — current Translation model, PipelineStep enum, pattern for adding enums
- `prisma.config.ts` — migration config (uses DIRECT_DATABASE_URL)
- `app/utils/env.server.ts` — Zod validation pattern for environment variables

### CosyVoice API Contract
- `.planning/PROJECT.md` §Context → CosyVoice 3 API Contract — endpoint spec, fields, response format

### Research
- `.planning/research/PITFALLS.md` — PCM format mismatch (P1), cross_lingual vs zero_shot mode confusion (P2)
- `.planning/research/ARCHITECTURE.md` — component changes and build order

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `fish-audio.server.ts` — direct template for service structure (headers helper, retry loop, response validation)
- `env.server.ts` — Zod schema with optional env vars pattern

### Established Patterns
- Services use object literal exports (not classes): `export const serviceName = { ... }`
- Retry with exponential backoff: `attempt * 1000` delay
- Console logging with prefix tags: `[fish-audio]` → `[cosyvoice]`
- Env vars accessed via `env` object, never raw `process.env`

### Integration Points
- `prisma/schema.prisma` — add `TtsEngine` enum and `ttsEngine` field to `Translation` model
- `app/utils/env.server.ts` — add `COSYVOICE_URL` as optional Zod string
- `.env.example` — add `COSYVOICE_URL` placeholder

</code_context>

<specifics>
## Specific Ideas

- CosyVoice `cross_lingual` mode: send `tts_text`, `mode`, `prompt_wav`, `speed`, `stream: "false"`. NO `prompt_text`.
- CosyVoice `zero_shot` mode: additionally send `prompt_text` prefixed with `You are a helpful assistant.<|endofprompt|>` followed by reference audio transcript.
- Response: raw PCM int16 bytes, 24,000 Hz, mono. Must be wrapped in WAV header (44 bytes) before FFmpeg processing.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-cosyvoice-service-schema*
*Context gathered: 2026-03-26*
