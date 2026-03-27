---
phase: 3
slug: ui-speaker-accuracy
status: pending_review
depends_on: "Phase 2"
---

# Phase 3: UI & Speaker Accuracy — Implementation Plan

<objective>
Improve the quality of multi-speaker extraction by fixing speaker diarization over-smoothing bugs, and build the frontend UI that allows users to explicitly select between Fish Audio and CosyVoice 3 TTS engines when starting a translation job.
</objective>

## Tasks

### 1. Fix Speaker Diarization Smoothing Bug
`app/services/assemblyai.server.ts`
- **Context:** The `smoothSpeakerLabels` function tries to fix short misdetected segments (e.g., A-B-A becomes A-A-A). 
- **Bug:** It currently mutates the result array *in-place* during iteration. When evaluating element `i`, it compares it to `prev` (element `i-1`). Because `i-1` might have just been mutated, a single misdetection can trigger a chain reaction that completely erases a long valid block of a different speaker.
- **Implementation:** 
  - Read neighbor labels from the *unmutated* original `segments` array, and apply corrections only to the new `result` array.
  - Fix Pass 1 (isolated segments) to use `segments[i-1].speaker` and `segments[i+1].speaker`.
  - Fix Pass 2 (short pairs) to use the original boundaries for evaluating runs.

### 2. Update Validation Schema
`app/utils/validation.ts`
- **Implementation:** 
  - Import `TtsEngine` enum from generic types or hardcode Zod enum `z.enum(["FISH_AUDIO", "COSYVOICE"])`.
  - Add `ttsEngine: z.enum(["FISH_AUDIO", "COSYVOICE"])` as a required field to `videoSubmitSchema`.

### 3. Build the TTS Engine Selector UI
`app/routes/platform/new-translation.tsx`
- **Implementation:** 
  - Implement the `03-UI-SPEC.md` visual contract for the engine selector above the Target Language dropdown.
  - Use `RadioGroup` or `Select` (from Shadcn) with two options:
    1. **CosyVoice 3 (GPU)** — "High-quality voice cloning (9 languages)"
    2. **Fish Audio** — "Versatile generation (12+ languages)"
  - Add state tracking `const [engine, setEngine] = useState<"FISH_AUDIO" | "COSYVOICE" | null>(null)`.
  - Feed the selected engine state into a hidden form input `name="ttsEngine"`.
  - In the `action` function, pass `ttsEngine` from the parsed Zod data directly into the `db.translation.create()` call.

### 4. Dynamic Language Filtering
`app/components/language-selector.tsx` & `new-translation.tsx`
- **Implementation:** 
  - Expose a generic prop `supportedLanguageCodes?: string[]` or `engine` to the `LanguageSelector` component.
  - If the engine is "COSYVOICE", filter the available languages strictly to: `["en", "zh", "ja", "ko", "de", "es", "fr", "it", "ru"]`.
  - If "FISH_AUDIO", allow all 20 default languages.
  - In `new-translation.tsx`, add an effect: if the user switches the engine and their currently `selectedLang` is no longer in the allowed list, reset `selectedLang` to `null` to require a fresh selection.

## Verification Plan

### Automated Tests
- N/A (Project does not currently enforce unit tests for route actions).

### Manual Verification
1. **Frontend UI Check:** Load `/platform/new`. Verify the Engine selector is present and styled according to the UI-SPEC (Tailwind radix-nova).
2. **Dynamic Filtering Check:** Select "Fish Audio", open Language Dropdown → verifies 20 languages. Shift selection to "CosyVoice 3", open Language Dropdown → verifies exactly 9 languages (English, Chinese, Japanese, Korean, German, Spanish, French, Italian, Russian).
3. **Reset Logic Check:** Select CosyVoice, select "Spanish". Change engine to Fish Audio → "Spanish" remains selected. Switch back to "Fish Audio", select "Dutch" (not supported by CosyVoice), change engine to "CosyVoice" → Language resets to empty.
4. **End-to-End Submission:** Select an engine, select a language, upload a file. Verify the database `Translation` record correctly stores the selected `ttsEngine`.
5. **Diarization Check:** If possible, upload a multi-speaker video and verify that the resulting transcript's speaker tags don't get aggressively wiped out into a single speaker (verify terminal output for `[assemblyai] Smoothed X speaker label(s)` showing a reasonable number, not runaway counts).
