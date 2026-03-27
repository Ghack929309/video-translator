---
phase: 3
slug: ui-speaker-accuracy
status: executed
one_liner: "Fixed AssemblyAI speaker diarization bugs and added a dynamic Shadcn UI TTS Engine selector to the translation flow."
---

# Phase 3 Summary

- **Backend Diarization Fix**: Resolved a critical mutation bug in `assemblyai.server.ts` where speaker smoothing triggered rolling overwrites during the array iteration passes in multi-speaker videos.
- **Schema Validation**: Updated the Zod `videoSubmitSchema` to strictly enforce the Prisma `TtsEngine` enum validation correctly as a required field.
- **Frontend Engine Selector**: Built a new functional engine selector using Shadcn `Select` in `new-translation.tsx` that aligns with the visual design contract in `03-UI-SPEC.md`.
- **Dynamic Formatting**: The `LanguageSelector` component was refactored with conditional rendering to filter available languages strictly down to the capabilities of the selected engine (9 options for CosyVoice 3 vs 20 options for Fish Audio), complete with auto-resetting state management.
