# Architecture

## Pattern
**Full-stack SSR + Background Worker** — React Router v7 server-rendered web app with a separate long-running worker process for async video translation.

## System Overview

```
┌─────────────────────────────────────────────────┐
│  Client (Browser)                               │
│  React 19 + Shadcn UI + Tailwind v4             │
└───────────────┬─────────────────────────────────┘
                │ HTTP
┌───────────────▼─────────────────────────────────┐
│  Web Server (React Router v7 SSR)               │
│  Loaders → Data fetching (Prisma)               │
│  Actions → Mutations (upload, create job)       │
│  API routes → REST endpoints                    │
└───────┬───────┬─────────────────────────────────┘
        │       │ enqueue
        │  ┌────▼──────────────────────────┐
        │  │  pgmq (PostgreSQL Queue)      │
        │  │  translation_process queue    │
        │  └────┬──────────────────────────┘
        │       │ poll
        │  ┌────▼──────────────────────────┐
        │  │  Worker Process               │
        │  │  7-step translation pipeline  │
        │  └───┬──┬──┬──┬─────────────────┘
        │      │  │  │  │
    ┌───▼──┐ ┌─▼┐┌▼─┐┌▼─┐┌──────┐
    │Prisma│ │S3││AI││FF││yt-dlp│
    │(PG)  │ │  ││  ││  ││     │
    └──────┘ └──┘└──┘└──┘└──────┘
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
  - Auto-creates `Profile` on first authenticated request (upsert pattern)
  - Admin role check (currently commented out — always grants admin)

### 5. Utilities (`app/utils/`)
- **`env.server.ts`** — Zod-validated environment variables (fail-fast on missing vars)
- **`validation.ts`**, `errors.ts`, `responses.server.ts`, `url.ts`, `constants.ts`, `mock-data.ts`

## Data Flow — Translation Pipeline

1. **User uploads video** (direct to Tigris via presigned URL) or **provides URL**
2. **Web server creates** `Video` + `Translation` records, enqueues job to pgmq
3. **Worker polls pgmq**, receives `{ translationId }` payload
4. **Pipeline runs 7 steps** sequentially with retry + resume:
   - `DOWNLOAD` → yt-dlp downloads URL sources (skipped for uploads)
   - `EXTRACT_AUDIO` → FFmpeg extracts WAV from video
   - `TRANSCRIBE` → AssemblyAI transcribes with speaker labels
   - `TRANSLATE` → OpenAI translates segments in batches of 20
   - `CLONE_VOICE` → Fish Audio clones per-speaker voice models
   - `SYNTHESIZE` → Fish Audio TTS + FFmpeg time-stretch to match original timing
   - `MERGE` → FFmpeg muxes synthesized audio onto original video
5. **Result stored** in Tigris, translation record updated to `COMPLETED`
6. **Client polls** `/api/jobs/:id/status` to track progress

## Key Abstractions
- **Pipeline steps are idempotent** — each checks if its output already exists before running
- **Retry with exponential backoff** — per-step retries (max 3), plus resume-from-failed on re-enqueue
- **Absolute time alignment** — synthesized segments use absolute position tracking (not relative) to prevent cumulative drift
- **Multi-speaker support** — voice cloning creates separate models per speaker, synthesis maps segments to correct voice
