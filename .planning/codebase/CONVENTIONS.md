# Code Conventions

## Language & Style
- **TypeScript strict mode** — `strict: true` in `tsconfig.json`
- **ES modules** — `"type": "module"`, `verbatimModuleSyntax: true`
- **No explicit `return` types on most functions** — relies on inference
- **Consistent `async/await`** — no raw `.then()` chains

## Naming
- **Files:** kebab-case (`fish-audio.server.ts`, `new-translation.tsx`, `jobs-id-status.ts`)
- **Server-only:** `*.server.ts` suffix (React Router excludes from client bundles)
- **Variables/functions:** camelCase (`translationId`, `createSupabaseClient`)
- **Types/interfaces:** PascalCase (`TranscriptSegment`, `TranslatedSegment`, `DownloadResult`)
- **Enums (Prisma):** UPPER_SNAKE_CASE (`PENDING`, `EXTRACT_AUDIO`, `CLONE_VOICE`)
- **Constants:** UPPER_SNAKE_CASE (`QUEUE_NAME`, `BATCH_SIZE`, `MAX_STEP_RETRIES`)
- **Services:** exported as named singletons (`db`, `tigris`, `assemblyai`, `openaiService`, `fishAudio`, `ffmpeg`, `ytdlp`, `pipeline`)

## Service Pattern
Services follow an **object literal with methods** pattern (not classes):

```typescript
export const serviceName = {
  async method1(...): Promise<T> { ... },
  async method2(...): Promise<T> { ... },
};
```

Used consistently across: `tigris`, `assemblyai`, `openaiService`, `fishAudio`, `ffmpeg`, `ytdlp`, `pipeline`.

## Database Pattern
- **Prisma singleton** via globalThis caching (hot-reload safe in dev)
- **PrismaPg adapter** — uses `pg` driver directly instead of Prisma's built-in postgres driver
- **Two connection URLs** — transaction pooler (runtime) vs direct (migrations)
- **Auth auto-provisioning** — `Profile.upsert()` on first authenticated request

## Component Pattern
- **Shadcn UI primitives** in `app/components/ui/` (not custom-built)
- **App components** compose Shadcn primitives with business logic
- **Providers in root:** `TooltipProvider`, `Toaster` (sonner)
- **Dark mode default:** `<html class="dark">`

## Error Handling
- **Pipeline:** try/catch per step → update translation record with `errorMessage` + `errorStep`
- **Worker:** catch pipeline errors → archive stale messages (P2025/not found), let others retry via visibility timeout
- **Env:** Fail-fast validation with Zod on startup
- **FFmpeg:** Promise-based wrappers around event emitters, stderr capture on failure
- **Fish Audio:** WAV header validation (RIFF check), retry with backoff for API failures

## Import Conventions
- **Path alias:** `~/` maps to `./app/` (configured in tsconfig + vite-tsconfig-paths)
- **Prisma import:** `from "prisma/prisma/client"` (custom output directory)
- **Node built-ins:** imported explicitly (`import * as fs from "fs"`)

## Environment Variables
- **Zod schema validation** at import time (`app/utils/env.server.ts`)
- **Fail-fast** — throws with formatted missing var list if validation fails
- **All vars accessed via `env` object** — never raw `process.env`

## Logging
- **Console-based** with service prefix tags: `[worker]`, `[pipeline]`, `[ffmpeg]`, `[assemblyai]`, `[fish-audio]`, `[openai]`, `[queue]`, `[yt-dlp]`
- **Structured progress:** step names, durations, file sizes, segment counts
- **Warnings for edge cases:** extreme stretch ratios, failed TTS fallbacks, speaker smoothing
