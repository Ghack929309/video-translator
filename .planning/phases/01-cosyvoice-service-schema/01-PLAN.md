---
phase: 1
plan: 1
title: "Prisma Schema Migration & ENV Config"
wave: 1
depends_on: []
files_modified:
  - prisma/schema.prisma
  - app/utils/env.server.ts
  - .env.example
autonomous: true
requirements_addressed: [SCHM-01, SCHM-02, SCHM-03]
---

# Plan 01: Prisma Schema Migration & ENV Config

<objective>
Add `TtsEngine` enum and `ttsEngine` field to the Translation model in the Prisma schema, add `COSYVOICE_URL` as an optional environment variable, and run the migration — all without breaking existing data.
</objective>

## Tasks

<task id="1">
<title>Add TtsEngine enum and ttsEngine field to Prisma schema</title>
<read_first>
- prisma/schema.prisma (current Translation model, existing enum patterns)
</read_first>
<action>
Add a new `TtsEngine` enum to `prisma/schema.prisma` with two values:

```prisma
enum TtsEngine {
  FISH_AUDIO
  COSYVOICE
}
```

Add a `ttsEngine` field to the `Translation` model with `FISH_AUDIO` as the default (right after the `targetLanguage` field):

```prisma
ttsEngine           TtsEngine         @default(FISH_AUDIO)
```

This ensures existing translations default to Fish Audio and the migration is non-breaking (new column with default value).
</action>
<acceptance_criteria>
- `prisma/schema.prisma` contains `enum TtsEngine {` with `FISH_AUDIO` and `COSYVOICE` values
- `Translation` model contains `ttsEngine TtsEngine @default(FISH_AUDIO)`
- Enum is placed after the `PipelineStep` enum block
</acceptance_criteria>
</task>

<task id="2">
<title>Add COSYVOICE_URL to env validation schema</title>
<read_first>
- app/utils/env.server.ts (current Zod schema pattern, existing optional patterns)
</read_first>
<action>
Add `COSYVOICE_URL` as an optional URL field to the Zod schema in `app/utils/env.server.ts`. Place it after the Fish Audio section:

```typescript
// CosyVoice (optional — required only when CosyVoice engine is selected)
COSYVOICE_URL: z.string().url().optional(),
```

This makes the app boot without the URL configured. A descriptive runtime error will be thrown by the CosyVoice service module (Plan 02) when a CosyVoice translation is attempted without the URL.
</action>
<acceptance_criteria>
- `app/utils/env.server.ts` contains `COSYVOICE_URL: z.string().url().optional()`
- The comment `// CosyVoice` appears above the field
- App still boots successfully without `COSYVOICE_URL` set
</acceptance_criteria>
</task>

<task id="3">
<title>Update .env.example with COSYVOICE_URL placeholder</title>
<read_first>
- .env.example (current format and ordering)
</read_first>
<action>
Add `COSYVOICE_URL` placeholder to `.env.example` after the Fish Audio section:

```
# CosyVoice (optional — only needed when using CosyVoice TTS engine)
COSYVOICE_URL=
```
</action>
<acceptance_criteria>
- `.env.example` contains `COSYVOICE_URL=`
- Comment above explains it's optional
</acceptance_criteria>
</task>

<task id="4">
<title>Generate and apply Prisma migration</title>
<read_first>
- prisma/schema.prisma (confirm enum and field are added from task 1)
</read_first>
<action>
Generate a Prisma migration for the new TtsEngine enum and ttsEngine field:

```bash
npx prisma migrate dev --name add-tts-engine
```

Then regenerate the Prisma client:

```bash
npx prisma generate
```

Verify the migration SQL adds the enum type and column with default value. The migration should be non-breaking for existing rows since FISH_AUDIO is the default.
</action>
<acceptance_criteria>
- Migration file exists in `prisma/migrations/` with name containing `add_tts_engine`
- Migration SQL contains `CREATE TYPE "TtsEngine"` with `FISH_AUDIO` and `COSYVOICE`
- Migration SQL contains `ALTER TABLE "Translation" ADD COLUMN "ttsEngine"` with default `FISH_AUDIO`
- `npx prisma generate` completes without errors
</acceptance_criteria>
</task>

## Verification

```bash
# Schema has TtsEngine enum
grep -q 'enum TtsEngine' prisma/schema.prisma && echo "PASS: TtsEngine enum exists" || echo "FAIL"

# Translation model has ttsEngine field
grep -q 'ttsEngine.*TtsEngine.*@default(FISH_AUDIO)' prisma/schema.prisma && echo "PASS: ttsEngine field exists" || echo "FAIL"

# ENV schema has optional COSYVOICE_URL
grep -q 'COSYVOICE_URL.*optional' app/utils/env.server.ts && echo "PASS: COSYVOICE_URL optional" || echo "FAIL"

# .env.example has placeholder
grep -q 'COSYVOICE_URL' .env.example && echo "PASS: .env.example updated" || echo "FAIL"

# Migration exists
ls prisma/migrations/*add*tts*engine* 2>/dev/null && echo "PASS: Migration exists" || echo "FAIL"

# Prisma client generates without errors
npx prisma generate 2>&1 | tail -1
```

## must_haves

- TtsEngine enum with FISH_AUDIO and COSYVOICE values
- ttsEngine field on Translation with FISH_AUDIO default
- COSYVOICE_URL optional in env validation
- Non-breaking migration for existing data
