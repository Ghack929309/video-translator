<!-- GSD:project-start source:PROJECT.md -->
## Project

**Dubly — Video Translation Platform**

A video translation platform that takes a source video (uploaded or from YouTube/Instagram/Facebook/Vimeo), transcribes the audio, translates it to a target language, clones the original speakers' voices, and produces a dubbed output video where each speaker sounds like themselves speaking the target language natively.

**Core Value:** The translated video must sound natural — each speaker's voice preserved, speaking the target language without accent bleed from the source language.

### Constraints

- **GPU host**: CosyVoice 3 requires NVIDIA GPU (8GB+ VRAM) — Fly.io has no GPU, RunPod Serverless is the deployment target
- **Cold starts**: RunPod Serverless cold starts (30–90s) acceptable since translation jobs are async
- **Model**: `Fun-CosyVoice3-0.5B-2512`, Apache 2.0 license, 0.5B parameters
- **Languages**: CosyVoice 3 supports 9 languages (EN, ZH, JA, KO, DE, ES, FR, IT, RU); Fish Audio covers the remaining 12
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Runtime & Language
- **Runtime:** Node.js 25 (`.nvmrc`)
- **Language:** TypeScript (strict mode, ES2022 target, bundler module resolution)
- **Module System:** ESM (`"type": "module"` in `package.json`)
## Framework
- **React Router v7** (7.13.1) — full-stack SSR framework (formerly Remix)
- **React 19** + React DOM 19
- **Vite 7** — bundler (`vite.config.ts`)
## Styling
- **Tailwind CSS v4** (4.2.1) — via `@tailwindcss/vite` plugin
- **Shadcn UI v4** (radix-nova style variant)
- **Typography:** Inter (sans), JetBrains Mono (mono), Geist Variable
- **Design tokens:** CSS custom properties with HSL values, purple primary (`hsl(262 83% 58%)`)
## Database & ORM
- **PostgreSQL** (Supabase-hosted)
- **Prisma 7** with `@prisma/adapter-pg` (PrismaPg adapter)
## Authentication
- **Supabase Auth** via `@supabase/ssr` (cookie-based SSR auth)
## Object Storage
- **Tigris** (S3-compatible, on Fly.io) via `@aws-sdk/client-s3`
## AI / ML Services
- **AssemblyAI** — speech-to-text transcription with word-level timestamps and speaker diarization
- **OpenAI** (GPT-4o-mini) — segment-level text translation with structured output (Zod schema)
- **Fish Audio** (S2 Pro model) — voice cloning + cross-lingual TTS synthesis
## Media Processing
- **FFmpeg** (`ffmpeg-static` + `fluent-ffmpeg`) — audio extraction, time-stretching, merging, concatenation, silence generation
- **yt-dlp** (Python CLI) — video download from YouTube, Instagram, Facebook, Vimeo
## Job Queue
- **pgmq** (Supabase Queue) — PostgreSQL-native message queue
## Validation
- **Zod v4** — environment variable validation (`app/utils/env.server.ts`), OpenAI structured output schemas
## Deployment
- **Fly.io** (`fly.toml`)
- **Docker** (multi-stage build, `node:20-alpine` base)
## Dev Tools
- **TypeScript** (5.9.3) — strict mode
- **Path aliases:** `~/` → `./app/*`
- **vite-tsconfig-paths** — resolves TS path aliases in Vite
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

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
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern
## System Overview
```
```
## Layers
### 1. Presentation Layer
- **Components:** `app/components/` — shared UI components (upload zone, language selector, translation card/progress)
- **UI Primitives:** `app/components/ui/` — Shadcn components (20+ primitives from radix-ui)
- **Root:** `app/root.tsx` — dark theme, Inter/JetBrains Mono fonts, TooltipProvider, Toaster
### 2. Route Layer
- **Site (public):** `/`, `/pricing`, `/about` — marketing pages
- **Login (guest):** `/login`, `/register`, `/forgot-password`, `/reset-password` — auth flow
- **Platform (auth):** `/platform`, `/platform/new`, `/platform/translations`, `/platform/translations/:id`, `/platform/settings`, `/platform/billing`
- **Admin (auth+role):** `/admin`, `/admin/users`, `/admin/jobs`
- **API:** `/api/upload`, `/api/jobs/:id/status` — REST endpoints for file upload and job status polling
### 3. Service Layer (`app/services/`)
- **`db.server.ts`** — Prisma client singleton (PrismaPg adapter, hot-reload safe)
- **`supabase.server.ts`** — Request-scoped + admin Supabase clients
- **`tigris.server.ts`** — S3-compatible object storage operations
- **`assemblyai.server.ts`** — Transcription with speaker diarization + smoothing
- **`openai.server.ts`** — Segment translation with structured output
- **`fish-audio.server.ts`** — Voice cloning + TTS synthesis
- **`ffmpeg.server.ts`** — Audio extraction, time-stretching, concatenation, merging
- **`ytdlp.server.ts`** — Video download from URLs
- **`worker.server.ts`** — pgmq queue management (enqueue/ensure/create)
- **`pipeline.server.ts`** — 883-line pipeline orchestrator (the core business logic)
### 4. Auth Layer (`app/services/middleware/`)
- **`auth.ts`** — `requireAuth()` and `requireAdmin()` middleware
### 5. Utilities (`app/utils/`)
- **`env.server.ts`** — Zod-validated environment variables (fail-fast on missing vars)
- **`validation.ts`**, `errors.ts`, `responses.server.ts`, `url.ts`, `constants.ts`, `mock-data.ts`
## Data Flow — Translation Pipeline
## Key Abstractions
- **Pipeline steps are idempotent** — each checks if its output already exists before running
- **Retry with exponential backoff** — per-step retries (max 3), plus resume-from-failed on re-enqueue
- **Absolute time alignment** — synthesized segments use absolute position tracking (not relative) to prevent cumulative drift
- **Multi-speaker support** — voice cloning creates separate models per speaker, synthesis maps segments to correct voice
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
