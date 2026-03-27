---
phase: 2
plan: 1
title: "Pipeline CosyVoice Integration"
wave: 1
depends_on: []
files_modified:
  - app/services/pipeline.server.ts
autonomous: true
requirements_addressed: [PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05]
---

# Plan 01: Pipeline CosyVoice Integration

<objective>
Add CosyVoice engine branching to `stepCloneVoice()` and `stepSynthesize()` in `pipeline.server.ts`. Uses if/else branching (not strategy pattern). CosyVoice path extracts per-speaker reference WAVs in step 5 and sends them inline with each synthesis call in step 6. Time-stretch and concatenation logic is shared between engines.
</objective>

## Tasks

<task id="1">
<title>Add CosyVoice import to pipeline</title>
<read_first>
- app/services/pipeline.server.ts (line 10: existing fishAudio import)
- app/services/cosyvoice.server.ts (exported cosyvoice object)
</read_first>
<action>
Add the CosyVoice import alongside the Fish Audio import at line 10:

```typescript
import { fishAudio } from "~/services/fish-audio.server";
import { cosyvoice } from "~/services/cosyvoice.server";
```

This is the only new import needed — all other dependencies (fs, path, os, db, tigris, ffmpeg) are already imported.
</action>
<acceptance_criteria>
- `pipeline.server.ts` contains `import { cosyvoice } from "~/services/cosyvoice.server"`
- Import is on the line after the fishAudio import
</acceptance_criteria>
</task>

<task id="2">
<title>Branch stepCloneVoice() for CosyVoice engine</title>
<read_first>
- app/services/pipeline.server.ts (lines 445–589: full stepCloneVoice method)
- app/services/cosyvoice.server.ts (no createVoiceModel — reference WAVs are sent inline)
</read_first>
<action>
Modify `stepCloneVoice()` to branch based on `translation.ttsEngine`. The method needs to:

1. **Add `ttsEngine` to the translation query** — Update the `findUniqueOrThrow` at line 451 to include the `ttsEngine` field (it's already returned by default since it's on the model, but be explicit).

2. **Adjust idempotency check** — The current check at line 457 (`if (translation.fishAudioVoiceMap || translation.fishAudioVoiceId)`) only applies to Fish Audio. For CosyVoice, check if per-speaker WAV files already exist in temp dir:

```typescript
// Skip if already cloned (engine-specific checks)
if (translation.ttsEngine === "COSYVOICE") {
  // CosyVoice doesn't create persistent models — check if reference WAVs exist
  const tmpDir = path.join(os.tmpdir(), "dubly", translationId);
  const hasRefs = fs.existsSync(path.join(tmpDir, "speaker-refs.json"));
  if (hasRefs) {
    console.log(`[pipeline] Step CLONE_VOICE skipped — CosyVoice speaker refs exist`);
    await updateTranslation(translationId, {
      currentStep: "CLONE_VOICE",
      progress: STEP_PROGRESS.CLONE_VOICE,
    });
    return;
  }
} else {
  // Fish Audio: check persistent voice models
  if (translation.fishAudioVoiceMap || translation.fishAudioVoiceId) {
    console.log(`[pipeline] Step CLONE_VOICE skipped — voice already cloned`);
    await updateTranslation(translationId, {
      currentStep: "CLONE_VOICE",
      progress: STEP_PROGRESS.CLONE_VOICE,
    });
    return;
  }
}
```

3. **Keep shared speaker detection code** — The speaker detection loop (lines 498–519) remains identical for both engines. The fork happens AFTER speaker audio extraction.

4. **Branch after per-speaker sample concatenation** — After `ffmpeg.concatenateAudio()` at line 557, branch for each engine:

**Fish Audio path (existing code, unchanged):**
```typescript
if (translation.ttsEngine !== "COSYVOICE") {
  // Trim + compress for Fish Audio upload limit
  const trimmedPath = path.join(tmpDir, `speaker-${speaker}-trimmed.mp3`);
  await ffmpeg.trimAndCompress(speakerSamplePath, trimmedPath, 30);
  const voiceId = await fishAudio.createVoiceModel(
    trimmedPath,
    `dubly-${translationId}-${speaker}`,
  );
  voiceMap[speaker] = voiceId;
  console.log(
    `[pipeline] Cloned voice for speaker ${speaker}: ${voiceId} (${totalDuration.toFixed(1)}s sample)`,
  );
}
```

**CosyVoice path (new):**
```typescript
if (translation.ttsEngine === "COSYVOICE") {
  // CosyVoice: keep the raw WAV reference — no model creation needed
  // Trim to 10s max for optimal cross-lingual synthesis
  const refPath = path.join(tmpDir, `speaker-${speaker}-ref.wav`);
  if (totalDuration > 10) {
    await ffmpeg.extractTimeRange(speakerSamplePath, 0, 10, refPath);
  } else {
    fs.copyFileSync(speakerSamplePath, refPath);
  }
  voiceMap[speaker] = refPath;
  console.log(
    `[pipeline] Extracted CosyVoice ref for speaker ${speaker}: ${refPath} (${Math.min(totalDuration, 10).toFixed(1)}s)`,
  );
}
```

5. **Branch voice map storage** — After the speaker loop, for CosyVoice write a JSON manifest of reference paths (for idempotency). For Fish Audio, keep existing DB storage:

```typescript
if (translation.ttsEngine === "COSYVOICE") {
  // Write speaker refs manifest for idempotency check on resume
  const refsManifest = path.join(tmpDir, "speaker-refs.json");
  fs.writeFileSync(refsManifest, JSON.stringify(voiceMap));
  console.log(
    `[pipeline] Step CLONE_VOICE complete — ${Object.keys(voiceMap).length} speaker ref(s) extracted`,
  );
  await updateTranslation(translationId, {
    progress: STEP_PROGRESS.CLONE_VOICE,
  });
} else {
  // Fish Audio: store model IDs in DB
  const firstVoiceId = Object.values(voiceMap)[0] ?? null;
  await updateTranslation(translationId, {
    fishAudioVoiceMap: voiceMap as unknown as Record<string, unknown>,
    fishAudioVoiceId: firstVoiceId,
    progress: STEP_PROGRESS.CLONE_VOICE,
  });
  console.log(
    `[pipeline] Step CLONE_VOICE complete — ${Object.keys(voiceMap).length} voice(s) cloned`,
  );
}
```
</action>
<acceptance_criteria>
- `stepCloneVoice()` checks `translation.ttsEngine` to branch behavior
- CosyVoice path extracts per-speaker reference WAVs (max 10s) without creating Fish Audio models
- CosyVoice path writes `speaker-refs.json` manifest to temp dir
- CosyVoice idempotency check reads `speaker-refs.json` existence
- Fish Audio path remains functionally unchanged (same model creation + DB storage)
- Both paths share the speaker detection and audio extraction loop
- `grep -q 'COSYVOICE' app/services/pipeline.server.ts` succeeds
</acceptance_criteria>
</task>

<task id="3">
<title>Branch stepSynthesize() for CosyVoice engine</title>
<read_first>
- app/services/pipeline.server.ts (lines 597–780: full stepSynthesize method)
- app/services/cosyvoice.server.ts (synthesize signature: text, promptWavPath, sourceLanguage, targetLanguage, speed)
</read_first>
<action>
Modify `stepSynthesize()` to branch based on `translation.ttsEngine`. The changes are minimal — only the voice lookup and TTS call differ:

1. **Update voice precondition check** (line 614) — CosyVoice doesn't use `fishAudioVoiceId`:

```typescript
if (translation.ttsEngine === "COSYVOICE") {
  // CosyVoice uses local WAV refs — check manifest exists
  const refsManifest = path.join(
    os.tmpdir(), "dubly", translationId, "speaker-refs.json"
  );
  if (!fs.existsSync(refsManifest)) {
    throw new Error(
      "No CosyVoice speaker refs — CLONE_VOICE step may have been skipped or temp files lost. Re-run from CLONE_VOICE."
    );
  }
} else {
  if (!translation.fishAudioVoiceId && !translation.fishAudioVoiceMap) {
    throw new Error(
      "No Fish Audio voice ID — CLONE_VOICE step may have been skipped",
    );
  }
}
```

2. **Build engine-specific voice lookup** — After the precondition check, build the voice map based on engine:

```typescript
let voiceMap: Record<string, string>;
let defaultVoiceId: string;

if (translation.ttsEngine === "COSYVOICE") {
  const refsManifest = path.join(
    os.tmpdir(), "dubly", translationId, "speaker-refs.json"
  );
  voiceMap = JSON.parse(fs.readFileSync(refsManifest, "utf-8"));
  defaultVoiceId = Object.values(voiceMap)[0];
} else {
  voiceMap = (translation.fishAudioVoiceMap ?? {}) as Record<string, string>;
  defaultVoiceId = translation.fishAudioVoiceId ?? Object.values(voiceMap)[0];
}
```

3. **Extract source language from transcript** — CosyVoice needs it for mode selection:

```typescript
// Source language for CosyVoice mode selection (cross_lingual vs zero_shot)
const transcriptData = translation.transcriptJson as unknown as {
  languageCode?: string | null;
};
const sourceLanguage = transcriptData?.languageCode ?? "en";
```

4. **Branch the TTS call inside the synthesis loop** (around line 712) — Replace the Fish Audio synthesis call with an engine branch:

```typescript
let audioBuffer: Buffer;

if (translation.ttsEngine === "COSYVOICE") {
  // CosyVoice: send reference WAV path inline
  const speakerRefPath = voiceMap[seg.speaker ?? "A"] ?? defaultVoiceId;
  audioBuffer = await cosyvoice.synthesize(
    seg.translatedText,
    speakerRefPath,
    sourceLanguage,
    translation.targetLanguage,
    prosodySpeed,
  );
} else {
  // Fish Audio: use persistent voice model ID
  const speakerVoiceId = voiceMap[seg.speaker ?? "A"] ?? defaultVoiceId;
  if (!speakerVoiceId) {
    throw new Error(`No voice ID for speaker ${seg.speaker ?? "A"}`);
  }
  audioBuffer = await fishAudio.synthesize(
    seg.translatedText,
    speakerVoiceId,
    translation.targetLanguage,
    prosodySpeed,
  );
}
fs.writeFileSync(rawPath, audioBuffer);
```

5. **Time-stretch and concatenation** — No changes needed. The existing `ffmpeg.timeStretchExact()`, silence insertion, and `concatenateAudio()` logic works identically for both engines since CosyVoice now returns WAV (via Phase 1's `pcmToWav` conversion).

6. **Rate limiting** — The existing 150ms delay between segments (line 754) applies to both engines.
</action>
<acceptance_criteria>
- `stepSynthesize()` checks `translation.ttsEngine` to branch TTS calls
- CosyVoice path reads `speaker-refs.json` for voice lookup (WAV paths, not model IDs)
- CosyVoice path calls `cosyvoice.synthesize(text, refPath, sourceLanguage, targetLanguage, speed)`
- Fish Audio path remains functionally unchanged (uses model IDs)
- Source language extracted from `transcriptJson.languageCode` (falls back to "en")
- Time-stretch, silence insertion, and concatenation logic is shared between engines (no duplication)
- Resume-from-failure works: CosyVoice detects missing refs and throws descriptive error
</acceptance_criteria>
</task>

## Verification

```bash
# CosyVoice import exists
grep -q "import { cosyvoice }" app/services/pipeline.server.ts && echo "PASS: Import" || echo "FAIL"

# Engine branching in stepCloneVoice
grep -q 'ttsEngine.*COSYVOICE' app/services/pipeline.server.ts && echo "PASS: Engine branch" || echo "FAIL"

# CosyVoice ref extraction 
grep -q 'speaker-refs.json' app/services/pipeline.server.ts && echo "PASS: Speaker refs manifest" || echo "FAIL"

# CosyVoice synthesis call
grep -q 'cosyvoice.synthesize' app/services/pipeline.server.ts && echo "PASS: CosyVoice synthesis" || echo "FAIL"

# Fish Audio synthesis still present
grep -q 'fishAudio.synthesize' app/services/pipeline.server.ts && echo "PASS: Fish Audio unchanged" || echo "FAIL"

# Source language extraction
grep -q 'languageCode' app/services/pipeline.server.ts && echo "PASS: Source language" || echo "FAIL"

# TypeScript compiles
npx tsc --noEmit 2>&1 | head -5
```

## must_haves

- Pipeline routes to correct TTS engine based on `translation.ttsEngine`
- CosyVoice path extracts per-speaker reference WAVs and caches them locally
- CosyVoice synthesis sends reference WAV inline (no persistent models)
- Time-stretch and concatenation shared between engines
- Resume-from-failure works for both engines
- Fish Audio path is functionally unchanged
