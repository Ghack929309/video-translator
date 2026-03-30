---
phase: 11-fix-audio-pipeline
plan: 04
subsystem: ui, forms, progress
tags: [switch-toggle, background-audio, failed-segments, pipeline-steps, ui-spec]

# Dependency graph
requires:
  - phase: 11-01
    provides: enableBackgroundMix, failedSegmentCount, failedSegments, SEPARATE_AUDIO fields on Translation model
provides:
  - enableBackgroundMix toggle on new translation form (default on)
  - Failed segment amber warning on translation detail page
  - 8-step pipeline progress display including SEPARATE_AUDIO
affects: [new-translation-form, translation-detail-page, translation-progress-component]

# Tech tracking
tech-stack:
  added: []
  patterns: [hidden-form-field-boolean-transform, amber-warning-conditional-render, role-alert-accessibility]

key-files:
  modified:
    - app/utils/validation.ts
    - app/routes/platform/new-translation.tsx
    - app/routes/platform/translation.tsx
    - app/components/translation-progress.tsx

key-decisions:
  - "enableBackgroundMix uses string-to-boolean Zod transform (val !== 'false') so missing field defaults to true"
  - "Failed segment warning uses amber-500 (not destructive red) to distinguish partial degradation from full failure"
  - "SEPARATE_AUDIO step labeled 'Separate Background' in UI for user-facing clarity"

patterns-established:
  - "Boolean toggle via hidden input + Zod string transform for form data"

requirements-completed: [BG-02, TTS-R06]

# Metrics
duration: 8min
completed: 2026-03-30
---

# Phase 11 Plan 04: UI Updates for Background Audio & Failed Segments Summary

**Background audio ducking toggle added to new translation form (default on), amber warning for failed TTS segments on detail page, and 8-step pipeline progress including Separate Background step**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-30T00:34:18Z
- **Completed:** 2026-03-30T00:42:07Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added `enableBackgroundMix` field to `videoSubmitSchema` with Zod string-to-boolean transform (`val !== "false"` ensures missing = true, matching D-06 default-on)
- Added Switch toggle "Preserve Background Audio" to new translation form between language selector and title input, with help text and hidden form field
- Wired `enableBackgroundMix` through form action destructuring to `db.translation.create` data
- Added `failedSegmentCount` and `totalSegmentCount` to translation detail page loader
- Added amber warning banner (border-amber-500/30, bg-amber-500/10) for partially failed translations with role="alert" accessibility
- Warning shows "{N} of {T} segments failed during voice synthesis and were replaced with silence" with conditional "otherwise complete" suffix for COMPLETED status
- Warning hidden when status is FAILED (existing error card handles that case)
- Updated STEPS array from 7 to 8 entries with new SEPARATE_AUDIO step labeled "Separate Background" between EXTRACT_AUDIO and TRANSCRIBE

## Task Details

### Task 1: enableBackgroundMix toggle on new translation form

**Files:** `app/utils/validation.ts`, `app/routes/platform/new-translation.tsx`

Changes:
- `videoSubmitSchema` gained `enableBackgroundMix: z.string().optional().transform((val) => val !== "false")`
- New `useState(true)` for toggle state
- Switch component imported and rendered with Label and help text per UI-SPEC.md
- Hidden input `name="enableBackgroundMix"` with value based on state
- Action destructures `enableBackgroundMix` from parsed data
- `db.translation.create` includes `enableBackgroundMix` in data object

**Status:** Code complete, verified

### Task 2: Failed segment warning and 8-step progress

**Files:** `app/routes/platform/translation.tsx`, `app/components/translation-progress.tsx`

Changes:
- Loader returns `failedSegmentCount` from Translation record and `totalSegmentCount` derived from `translatedJson` array length
- Amber warning banner rendered between Pipeline Progress card and Translation Details card when `failedSegmentCount > 0` and status is not FAILED
- AlertTriangle icon with aria-hidden="true", heading text, and dynamic body text
- STEPS array updated to 8 entries with `{ key: "SEPARATE_AUDIO", label: "Separate Background" }` at index 2

**Status:** Code complete, verified

## Task Commits

Commits could not be created due to parallel execution sandbox restrictions on `git commit`. All code changes are in the working tree and staged, ready for the orchestrator to commit:

1. **Task 1:** `app/utils/validation.ts`, `app/routes/platform/new-translation.tsx` -- enableBackgroundMix toggle
2. **Task 2:** `app/components/translation-progress.tsx`, `app/routes/platform/translation.tsx` -- failed segment warning + 8-step progress

## Files Created/Modified
- `app/utils/validation.ts` -- Added enableBackgroundMix field to videoSubmitSchema
- `app/routes/platform/new-translation.tsx` -- Switch toggle, hidden input, action wiring, db.translation.create update
- `app/routes/platform/translation.tsx` -- Loader adds failedSegmentCount/totalSegmentCount, amber warning banner
- `app/components/translation-progress.tsx` -- STEPS array updated from 7 to 8 entries with SEPARATE_AUDIO

## Decisions Made
- `enableBackgroundMix` uses Zod `.string().optional().transform((val) => val !== "false")` so that a missing field (default) evaluates to `true`, matching D-06 default-on requirement
- Failed segment warning uses `amber-500` color (not `destructive` red) per UI-SPEC.md to distinguish partial degradation from full failure
- SEPARATE_AUDIO step labeled "Separate Background" for user-facing clarity, pairing naturally with "Preserve Background Audio" toggle

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- all UI elements are wired to real data fields (enableBackgroundMix from form to DB, failedSegmentCount from DB to UI).

## Self-Check: PASSED

All 4 modified files confirmed present with correct content via Grep verification. Code changes match all acceptance criteria from both tasks.

---
*Phase: 11-fix-audio-pipeline*
*Completed: 2026-03-30*
