---
phase: 1
plan: 2
title: "CosyVoice Service Module"
wave: 1
depends_on: []
files_modified:
  - app/services/cosyvoice.server.ts
autonomous: true
requirements_addressed: [COSY-01, COSY-02, COSY-03, COSY-04, COSY-05, COSY-06]
---

# Plan 02: CosyVoice Service Module

<objective>
Create `app/services/cosyvoice.server.ts` — a standalone HTTP client for the CosyVoice 3 inference endpoint. Mirrors the Fish Audio service pattern (object literal export, retry with backoff, response validation). Handles multipart/form-data requests, cross_lingual/zero_shot mode selection, and raw PCM-to-WAV conversion.
</objective>

## Tasks

<task id="1">
<title>Create cosyvoice.server.ts with PCM-to-WAV helper</title>
<read_first>
- app/services/fish-audio.server.ts (service pattern: object literal export, retry loop, response validation, logging conventions)
- app/utils/env.server.ts (how to import and use env object)
- .planning/PROJECT.md (CosyVoice 3 API Contract section — endpoint spec, fields, response format)
</read_first>
<action>
Create `app/services/cosyvoice.server.ts` with the following structure:

**1. Imports and constants:**
```typescript
import * as fs from "fs";
import { env } from "~/utils/env.server";
```

Constants:
- `COSYVOICE_SAMPLE_RATE = 24000`
- `COSYVOICE_CHANNELS = 1`
- `COSYVOICE_BIT_DEPTH = 16`
- `MAX_RETRIES = 2`

Supported languages constant:
```typescript
const COSYVOICE_LANGUAGES = ["en", "zh", "ja", "ko", "de", "es", "fr", "it", "ru"] as const;
type CosyVoiceLanguage = typeof COSYVOICE_LANGUAGES[number];
```

**2. PCM-to-WAV helper function:**
```typescript
function pcmToWav(pcmBuffer: Buffer): Buffer
```
- Creates a 44-byte WAV header (RIFF/WAVE format)
- Parameters: sampleRate=24000, numChannels=1, bitsPerSample=16
- Header fields: ChunkID="RIFF", Format="WAVE", Subchunk1ID="fmt ", AudioFormat=1 (PCM), SubChunk2ID="data"
- File size = 36 + pcmBuffer.length
- Data size = pcmBuffer.length
- Byte rate = 24000 * 1 * 2 = 48000
- Block align = 1 * 2 = 2
- Returns Buffer.concat([header, pcmBuffer])

**3. Mode selection helper:**
```typescript
function selectMode(sourceLanguage: string, targetLanguage: string): "cross_lingual" | "zero_shot"
```
- Returns `"zero_shot"` when sourceLanguage === targetLanguage
- Returns `"cross_lingual"` when they differ

**4. Duration estimation helper (for validation):**
```typescript
function estimateDurationSec(pcmBytes: number): number
```
- Formula: `pcmBytes / (COSYVOICE_SAMPLE_RATE * COSYVOICE_CHANNELS * (COSYVOICE_BIT_DEPTH / 8))`
- Simplifies to: `pcmBytes / 48000`

**5. Main service export:**
```typescript
export const cosyvoice = {
  SUPPORTED_LANGUAGES: COSYVOICE_LANGUAGES,

  async synthesize(
    text: string,
    promptWavPath: string,
    sourceLanguage: string,
    targetLanguage: string,
    speed?: number,
    promptText?: string,
  ): Promise<Buffer>
}
```

**synthesize method implementation:**

a. **Guard: check COSYVOICE_URL is set**
```typescript
if (!env.COSYVOICE_URL) {
  throw new Error(
    "COSYVOICE_URL is not configured. Set it in your .env file to use CosyVoice TTS engine."
  );
}
```

b. **Guard: reject empty text**
```typescript
if (!text || text.trim().length === 0) {
  throw new Error("Cannot synthesize empty text");
}
```

c. **Select mode** using `selectMode(sourceLanguage, targetLanguage)`

d. **Build multipart/form-data:**
```typescript
const form = new FormData();
form.append("tts_text", text);
form.append("mode", mode);
form.append("stream", "false");
form.append("speed", String(Math.max(0.5, Math.min(2.0, speed ?? 1.0))));

const wavBuffer = fs.readFileSync(promptWavPath);
const wavBlob = new Blob([wavBuffer], { type: "audio/wav" });
form.append("prompt_wav", wavBlob, "reference.wav");
```

e. **If zero_shot mode, add prompt_text:**
```typescript
if (mode === "zero_shot") {
  const prefix = "You are a helpful assistant.<|endofprompt|>";
  const fullPromptText = promptText ? `${prefix}${promptText}` : prefix;
  form.append("prompt_text", fullPromptText);
}
```

f. **Retry loop (matching Fish Audio pattern):**
- MAX_RETRIES = 2
- Exponential backoff: `attempt * 1000` ms delay
- Log each attempt: `[cosyvoice] Retry {attempt}/{MAX_RETRIES} after {delay}ms...`

g. **Fetch and validate:**
```typescript
const res = await fetch(`${env.COSYVOICE_URL}/inference`, {
  method: "POST",
  body: form,
});

if (!res.ok) {
  const errText = await res.text();
  throw new Error(`CosyVoice inference failed (${res.status}): ${errText}`);
}

const arrayBuffer = await res.arrayBuffer();
const pcmBuffer = Buffer.from(arrayBuffer);
```

h. **Validate PCM response:**
```typescript
if (pcmBuffer.length === 0) {
  throw new Error("CosyVoice returned empty response");
}

const durationSec = estimateDurationSec(pcmBuffer.length);
if (durationSec < 0.1) {
  throw new Error(
    `CosyVoice returned suspiciously short audio (${durationSec.toFixed(2)}s, ${pcmBuffer.length} bytes)`
  );
}

console.log(
  `[cosyvoice] Synthesized ${durationSec.toFixed(2)}s audio (${pcmBuffer.length} bytes PCM, mode: ${mode})`
);
```

i. **Convert PCM to WAV and return:**
```typescript
return pcmToWav(pcmBuffer);
```

The full method wraps the fetch + validation in try/catch within the retry loop, storing `lastError` and re-throwing after all retries are exhausted (identical pattern to `fish-audio.server.ts` lines 130-187).
</action>
<acceptance_criteria>
- File `app/services/cosyvoice.server.ts` exists
- Exports `cosyvoice` object literal with `synthesize` method and `SUPPORTED_LANGUAGES` constant
- `synthesize` method signature includes: text, promptWavPath, sourceLanguage, targetLanguage, speed?, promptText?
- Contains `pcmToWav` function that creates 44-byte WAV header with RIFF/WAVE format
- WAV header uses sampleRate=24000, numChannels=1, bitsPerSample=16
- Contains `selectMode` function returning "cross_lingual" or "zero_shot"
- Mode selection: cross_lingual when languages differ, zero_shot when same
- zero_shot mode appends `prompt_text` with "You are a helpful assistant.<|endofprompt|>" prefix
- cross_lingual mode does NOT send `prompt_text` field
- Validates `env.COSYVOICE_URL` is set before making request, throws descriptive error if not
- Validates PCM response is non-empty and duration >= 0.1s
- Uses retry loop with MAX_RETRIES=2 and exponential backoff (attempt * 1000ms)
- Logs with `[cosyvoice]` prefix
- Imports `env` from `~/utils/env.server`
- Speed is clamped to 0.5–2.0 range
- `COSYVOICE_LANGUAGES` array contains exactly: en, zh, ja, ko, de, es, fr, it, ru
</acceptance_criteria>
</task>

## Verification

```bash
# File exists
test -f app/services/cosyvoice.server.ts && echo "PASS: File exists" || echo "FAIL"

# Exports cosyvoice object
grep -q 'export const cosyvoice' app/services/cosyvoice.server.ts && echo "PASS: Export exists" || echo "FAIL"

# Has synthesize method
grep -q 'async synthesize' app/services/cosyvoice.server.ts && echo "PASS: synthesize method" || echo "FAIL"

# Has PCM-to-WAV conversion
grep -q 'pcmToWav' app/services/cosyvoice.server.ts && echo "PASS: pcmToWav helper" || echo "FAIL"

# Has mode selection
grep -q 'cross_lingual' app/services/cosyvoice.server.ts && echo "PASS: cross_lingual mode" || echo "FAIL"
grep -q 'zero_shot' app/services/cosyvoice.server.ts && echo "PASS: zero_shot mode" || echo "FAIL"

# Has prompt_text prefix for zero_shot
grep -q 'endofprompt' app/services/cosyvoice.server.ts && echo "PASS: prompt_text prefix" || echo "FAIL"

# Has retry logic
grep -q 'MAX_RETRIES' app/services/cosyvoice.server.ts && echo "PASS: Retry logic" || echo "FAIL"

# Has COSYVOICE_URL validation
grep -q 'COSYVOICE_URL' app/services/cosyvoice.server.ts && echo "PASS: URL validation" || echo "FAIL"

# Has supported languages
grep -q 'COSYVOICE_LANGUAGES' app/services/cosyvoice.server.ts && echo "PASS: Languages constant" || echo "FAIL"

# Has duration estimation
grep -q 'estimateDurationSec\|durationSec' app/services/cosyvoice.server.ts && echo "PASS: Duration validation" || echo "FAIL"

# TypeScript compiles
npx tsc --noEmit app/services/cosyvoice.server.ts 2>&1 | head -5
```

## must_haves

- Standalone CosyVoice service module mirroring Fish Audio pattern
- Correct mode selection (cross_lingual vs zero_shot) based on source/target language
- PCM-to-WAV conversion with correct 24kHz/mono/int16 header
- Response validation via size + duration estimation
- Retry with exponential backoff (2 retries)
- Runtime guard for missing COSYVOICE_URL
- SUPPORTED_LANGUAGES exported for UI consumption
