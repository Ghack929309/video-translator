# Video Translator MVP — Architecture & Build Guidelines

## Project overview

A web application that allows users to upload videos or paste links (YouTube, Instagram, Facebook, Vimeo), select a target language, and receive the same video dubbed with a voice-cloned audio track synchronized to the original timing.

---

## Tech stack

| Layer               | Technology                                 |
| ------------------- | ------------------------------------------ |
| Framework           | React Router v7 (framework mode)           |
| Language            | TypeScript (strict mode)                   |
| Database            | Supabase PostgreSQL via Prisma ORM         |
| Auth                | Supabase Auth (@supabase/ssr)              |
| Job queue           | pg-boss (running on Supabase PostgreSQL)   |
| Object storage      | Tigris (S3-compatible, on Fly.io)          |
| Hosting             | Fly.io                                     |
| Transcription       | AssemblyAI API                             |
| Translation         | OpenAI GPT-4o-mini                         |
| Voice cloning / TTS | Fish Audio API (OpenAudio S1)              |
| Video download      | yt-dlp (via child_process)                 |
| Video processing    | FFmpeg (via fluent-ffmpeg + ffmpeg-static) |
| Styling             | Tailwind CSS v4                            |

### Why Supabase for auth, queues, and database

**Auth** — Supabase Auth provides email/password, OAuth (Google, GitHub, etc.), magic links, and session management out of the box. No password hashing, session table, or token rotation code to write. The `@supabase/ssr` package handles cookie-based sessions natively in React Router v7 server functions.

**Database** — Supabase runs standard PostgreSQL. Prisma connects to it via the connection pooler (port 6543, transaction mode) for the web server and via the direct connection (port 5432) for migrations and the worker. This is a single managed Postgres instance replacing both Fly.io Postgres and any separate queue infrastructure.

**Queues** — pg-boss runs directly on Supabase's PostgreSQL. No additional service needed. Supabase also offers native Queues (based on pgmq) accessible via SQL/dashboard, but pg-boss provides a superior TypeScript DX with built-in retries, backoff, dead-letter queues, and completion events — all critical for a multi-step processing pipeline. Both options cost $0 since they use the same database.

---

## Folder structure

```
/
├── app/
│   ├── entry.client.tsx
│   ├── entry.server.tsx
│   ├── root.tsx
│   ├── routes.ts                    # Route config (React Router v7)
│   │
│   ├── routes/
│   │   ├── site/                    # Public pages — no auth required
│   │   │   ├── home.tsx             # GET /
│   │   │   ├── pricing.tsx          # GET /pricing
│   │   │   ├── about.tsx            # GET /about
│   │   │   ├── terms.tsx            # GET /terms
│   │   │   └── privacy.tsx          # GET /privacy
│   │   │
│   │   ├── login/                   # Auth pages — redirects to /platform if logged in
│   │   │   ├── login.tsx            # GET/POST /login (email + OAuth buttons)
│   │   │   ├── register.tsx         # GET/POST /register
│   │   │   ├── forgot-password.tsx  # GET/POST /forgot-password
│   │   │   ├── reset-password.tsx   # GET /reset-password (Supabase redirect target)
│   │   │   ├── callback.tsx         # GET /login/callback (OAuth + magic link handler)
│   │   │   └── logout.tsx           # POST /logout
│   │   │
│   │   ├── platform/               # Protected app — requires auth
│   │   │   ├── layout.tsx           # Shared layout with sidebar/nav
│   │   │   ├── dashboard.tsx        # GET /platform
│   │   │   ├── new-translation.tsx  # GET/POST /platform/new
│   │   │   ├── translations.tsx     # GET /platform/translations
│   │   │   ├── translation.tsx      # GET /platform/translations/:id
│   │   │   ├── settings.tsx         # GET/POST /platform/settings
│   │   │   └── billing.tsx          # GET /platform/billing
│   │   │
│   │   ├── admin/                   # Admin panel — requires auth + admin role
│   │   │   ├── layout.tsx           # Admin layout
│   │   │   ├── dashboard.tsx        # GET /admin
│   │   │   ├── users.tsx            # GET /admin/users
│   │   │   ├── jobs.tsx             # GET /admin/jobs
│   │   │   └── jobs.$id.tsx         # GET /admin/jobs/:id
│   │   │
│   │   └── api/                     # API resource routes (no UI)
│   │       ├── webhooks.assemblyai.ts
│   │       ├── jobs.$id.status.ts   # GET /api/jobs/:id/status (polling)
│   │       └── upload.ts            # POST /api/upload (presigned URL)
│   │
│   ├── services/                    # All external API + business logic
│   │   ├── supabase.server.ts       # Supabase client factory + auth helpers
│   │   ├── assemblyai.server.ts     # Transcription
│   │   ├── openai.server.ts         # Translation via GPT-4o-mini
│   │   ├── fish-audio.server.ts     # Voice cloning + TTS
│   │   ├── tigris.server.ts         # S3-compatible storage client
│   │   ├── ytdlp.server.ts          # Video downloading
│   │   ├── ffmpeg.server.ts         # Audio/video processing
│   │   ├── pipeline.server.ts       # Orchestrator — runs the 7-step pipeline
│   │   ├── worker.server.ts         # pg-boss worker setup + job handlers
│   │   └── email.server.ts          # Transactional emails (optional for MVP)
│   │
│   ├── types/                       # Shared TypeScript types
│   │   ├── translation.ts           # Translation, TranslationStatus, etc.
│   │   ├── video.ts                 # Video, VideoSource, etc.
│   │   ├── user.ts                  # Profile, UserRole, etc.
│   │   ├── pipeline.ts              # PipelineStep, PipelineResult, etc.
│   │   └── api.ts                   # API request/response shapes
│   │
│   ├── utils/                       # Pure utility functions
│   │   ├── env.server.ts            # Typed env var access (throws if missing)
│   │   ├── time.ts                  # Duration formatting, time calculations
│   │   ├── validation.ts            # Zod schemas for form/API validation
│   │   ├── url.ts                   # URL parsing, platform detection
│   │   ├── errors.ts                # Custom error classes
│   │   ├── constants.ts             # App-wide constants
│   │   └── responses.server.ts      # Typed JSON response helpers
│   │
│   ├── components/                  # Reusable React components
│   │   ├── ui/                      # Generic UI primitives (Button, Input, Card, etc.)
│   │   ├── video-player.tsx
│   │   ├── upload-zone.tsx
│   │   ├── url-input.tsx
│   │   ├── language-selector.tsx
│   │   ├── translation-progress.tsx
│   │   └── translation-card.tsx
│   │
│   ├── hooks/                       # Custom React hooks
│   │   ├── use-polling.ts           # Poll job status every N seconds
│   │   └── use-upload.ts            # Handle file upload + progress
│   │
│   └── middleware/                   # React Router v7 middleware
│       ├── auth.ts                  # Redirect to /login if no Supabase session
│       └── admin.ts                 # Redirect to /platform if not admin role
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
│
├── public/
│   └── ...
│
├── worker.ts                        # Entrypoint for the pg-boss worker process
├── fly.toml
├── Dockerfile
├── docker-compose.yml               # Local dev: app + local supabase (npx supabase start)
├── .env.example
├── tailwind.config.ts
└── tsconfig.json
```

---

## Rules and conventions

### General

1. **Every file that touches Node.js APIs or secrets must end in `.server.ts`** — React Router v7 tree-shakes these out of client bundles.
2. **No business logic in route files.** Routes call services; services contain the logic. A route loader or action should be 10–30 lines max.
3. **Zod for all validation.** Every form submission and API request is validated with a Zod schema defined in `app/utils/validation.ts`. Never trust `formData` or `request.json()` directly.
4. **Fail loudly in dev, gracefully in prod.** Use `app/utils/env.server.ts` to validate all env vars at startup. Missing vars crash the process immediately rather than failing silently later.
5. **No `any` types.** Use `unknown` and narrow. Enable `strict: true` in tsconfig.
6. **One export per service file.** Each `.server.ts` file exports a single object or class with named methods. No scattered function exports.

### Routes

7. **Four route groups, four access levels:**
   - `/site/*` → Public. No auth check. Marketing pages, legal pages.
   - `/login/*` → Guest only. If already authenticated, redirect to `/platform`.
   - `/platform/*` → Authenticated users. Middleware checks Supabase session, redirects to `/login` if absent.
   - `/admin/*` → Authenticated + `role === "admin"` on the Profile record. Middleware redirects to `/platform` if not admin.
8. **API routes live under `/api/*`** and export only `loader`/`action` (no default component). They return JSON via typed response helpers.
9. **Route files are thin.** A route file contains: one `loader` (optional), one `action` (optional), one default export component. Nothing else.

### Supabase auth integration

10. **Create a request-scoped Supabase client in every loader/action that needs auth.** Use `createServerClient` from `@supabase/ssr`, passing the request's cookies. Never use a singleton Supabase client for auth — sessions are per-request.
11. **The `supabase.server.ts` file exports two things:** a `createClient(request)` factory for request-scoped auth operations, and a `supabaseAdmin` service client (using the service_role key) for server-side operations that bypass RLS (used by the worker and admin routes only).
12. **User profiles live in a Prisma-managed `Profile` table**, linked to `auth.users` by ID. Supabase Auth owns the user identity (email, password, OAuth tokens); the Profile table owns app-specific data (role, name, usage quotas). Create the Profile record via a Supabase database trigger on `auth.users` insert, or lazily in middleware on first authenticated request.
13. **Never store passwords, tokens, or session data in Prisma.** Supabase Auth handles all of that. The Profile table only stores application data.
14. **OAuth callback route (`/login/callback`)** exchanges the auth code for a session using `supabase.auth.exchangeCodeForSession(code)`. This route is the redirect target for all OAuth providers and magic links configured in the Supabase dashboard.

### Services

15. **Services are stateless singletons** (except Supabase auth client, which is request-scoped). Instantiate API clients once at module level, export methods that accept explicit arguments and return typed results.
16. **Every external API call must have error handling and retries.** Wrap calls in try/catch, throw typed custom errors from `app/utils/errors.ts`. The pipeline orchestrator handles retries.
17. **Service files never import from `app/routes/`.** The dependency arrow is always: `routes → services → utils/types`. Never the reverse.
18. **The `.server.ts` suffix is mandatory for all services.** Even if a service doesn't use secrets today, it might tomorrow. Be consistent.

### Types

19. **Prisma-generated types are the source of truth for DB shapes.** Don't redefine them. Import from `~/generated/prisma`. Files in `app/types/` define derived types, DTOs, and non-DB types only (API responses, pipeline states, form shapes).
20. **Use discriminated unions for status fields.** For example: `type TranslationStatus = "pending" | "downloading" | "transcribing" | "translating" | "synthesizing" | "merging" | "completed" | "failed"`.

### Utils

21. **Utils are pure functions with no side effects and no external dependencies.** If it calls an API or reads from the DB, it belongs in `app/services/`.
22. **`env.server.ts` is the only place that reads `process.env`.** Every other file imports the typed env object. This prevents typos and ensures validation.

### Worker

23. **The worker runs as a separate Fly.io process, not inside the web server.** Define it in `fly.toml` under `[processes]`. It shares the same codebase and Docker image but runs `worker.ts` instead of the web entrypoint.
24. **The worker connects to Supabase PostgreSQL via the direct connection string** (port 5432), not the pooler. pg-boss uses `LISTEN/NOTIFY` which requires a persistent direct connection. The web server uses the pooler (port 6543) via Prisma.
25. **Jobs are idempotent.** If a job fails at step 4 (translate), restarting it should skip steps 1–3 by checking for existing intermediate artifacts in Tigris. Store `currentStep` and intermediate keys in the Translation record.
26. **Worker process has a graceful shutdown handler.** On `SIGTERM` (Fly.io deploys), finish the current job step before exiting. Don't leave half-processed files in storage.

### Storage

27. **All file I/O goes through Tigris, never local disk** (except temporary FFmpeg working files in `/tmp`). Clean up `/tmp` after every job — Fly.io machines have limited disk.
28. **Use structured storage keys:** `videos/{videoId}/source.mp4`, `translations/{translationId}/audio.wav`, `translations/{translationId}/output.mp4`, etc.
29. **Serve output videos via time-limited presigned URLs** (1 hour expiry). Never expose raw Tigris keys to the client.

### Error handling

30. **Every pipeline step writes its state to the DB before and after execution.** If the worker crashes, the pipeline knows exactly where to resume.
31. **Max 3 retries per job**, then mark as `failed` with `errorMessage`. Surface errors to the user in the UI and to admins in `/admin/jobs/:id`.
32. **Custom error classes** for each failure mode: `TranscriptionError`, `TranslationError`, `TTSError`, `DownloadError`, `ProcessingError`. Each carries a `retryable: boolean` flag.

---

## Database schema (Prisma)

Supabase Auth manages the `auth.users` table. Prisma manages all application tables. The `Profile` table links to `auth.users` by sharing the same ID.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")         // Pooler (port 6543) for web
  directUrl = env("DIRECT_DATABASE_URL")  // Direct (port 5432) for migrations + worker
}

model Profile {
  id        String   @id                   // Same as Supabase auth.users.id
  email     String   @unique
  name      String?
  role      Role     @default(USER)
  avatarUrl String?
  videos    Video[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Video {
  id            String        @id @default(cuid())
  profileId     String
  profile       Profile       @relation(fields: [profileId], references: [id], onDelete: Cascade)
  title         String
  sourceType    SourceType    // UPLOAD, YOUTUBE, INSTAGRAM, FACEBOOK, VIMEO
  sourceUrl     String?       // Original URL if pasted
  storageKey    String        // Tigris key for source video
  durationSec   Int?
  mimeType      String?
  fileSizeBytes Int?
  translations  Translation[]
  createdAt     DateTime      @default(now())
}

model Translation {
  id              String            @id @default(cuid())
  videoId         String
  video           Video             @relation(fields: [videoId], references: [id], onDelete: Cascade)
  targetLanguage  String            // ISO 639-1 code (e.g., "fr", "es", "ja")
  status          TranslationStatus @default(PENDING)
  currentStep     PipelineStep?
  progress        Int               @default(0)   // 0–100
  // Intermediate artifact keys in Tigris
  extractedAudioKey String?
  transcriptJson    Json?            // Word-level timestamped transcript
  translatedJson    Json?            // Translated segments with timing
  synthesizedAudioKey String?
  resultVideoKey    String?          // Final dubbed video
  // Voice cloning
  fishAudioVoiceId  String?          // Cloned voice model ID
  // Error tracking
  errorMessage      String?
  errorStep         PipelineStep?
  retryCount        Int              @default(0)
  // Timestamps
  startedAt         DateTime?
  completedAt       DateTime?
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt
}

enum Role {
  USER
  ADMIN
}

enum SourceType {
  UPLOAD
  YOUTUBE
  INSTAGRAM
  FACEBOOK
  VIMEO
}

enum TranslationStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

enum PipelineStep {
  DOWNLOAD
  EXTRACT_AUDIO
  TRANSCRIBE
  TRANSLATE
  CLONE_VOICE
  SYNTHESIZE
  MERGE
}
```

### Profile creation trigger (run once in Supabase SQL Editor)

This trigger automatically creates a Profile row whenever a new user signs up through Supabase Auth:

```sql
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public."Profile" (id, email, name, "avatarUrl", "createdAt", "updatedAt")
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url',
    now(),
    now()
  );
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

---

## Supabase client setup

### `app/services/supabase.server.ts`

```typescript
import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { env } from "~/utils/env.server";

/**
 * Request-scoped Supabase client — use in loaders/actions for auth.
 * Reads and writes session cookies from/to the request/response.
 */
export function createSupabaseClient(request: Request, headers: Headers) {
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get("Cookie") ?? "");
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          headers.append(
            "Set-Cookie",
            serializeCookieHeader(name, value, options),
          );
        });
      },
    },
  });
}

/**
 * Admin client — uses service_role key, bypasses RLS.
 * Use ONLY in the worker process and admin routes.
 * Never expose to the client.
 */
export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
);
```

### Auth middleware pattern — `app/middleware/auth.ts`

```typescript
import { redirect } from "react-router";
import { createSupabaseClient } from "~/services/supabase.server";
import { db } from "~/services/db.server";

export async function requireAuth(request: Request, headers: Headers) {
  const supabase = createSupabaseClient(request, headers);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw redirect("/login", { headers });
  }

  const profile = await db.profile.findUnique({ where: { id: user.id } });
  if (!profile) {
    throw redirect("/login", { headers });
  }

  return { user, profile, supabase };
}

export async function requireAdmin(request: Request, headers: Headers) {
  const { user, profile, supabase } = await requireAuth(request, headers);

  if (profile.role !== "ADMIN") {
    throw redirect("/platform", { headers });
  }

  return { user, profile, supabase };
}
```

### Usage in a route loader

```typescript
// app/routes/platform/dashboard.tsx
import { requireAuth } from "~/middleware/auth";

export async function loader({ request }: LoaderFunctionArgs) {
  const headers = new Headers();
  const { profile } = await requireAuth(request, headers);

  const translations = await db.translation.findMany({
    where: { video: { profileId: profile.id } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return data({ translations }, { headers });
}
```

---

## Processing pipeline — step-by-step

The pipeline orchestrator (`app/services/pipeline.server.ts`) runs these seven steps sequentially. Each step is idempotent — it checks for existing output before re-executing.

```
Step 1 — DOWNLOAD
  Input:  sourceUrl or uploaded storageKey
  Action: yt-dlp downloads video → saves to Tigris at videos/{videoId}/source.mp4
  Output: storageKey on the Video record
  Skip if: storageKey already exists (user uploaded directly)

Step 2 — EXTRACT_AUDIO
  Input:  storageKey (source video in Tigris)
  Action: Download from Tigris to /tmp → FFmpeg extracts audio as WAV
          → Upload WAV to Tigris at translations/{id}/source-audio.wav
  Output: extractedAudioKey on Translation
  Skip if: extractedAudioKey already exists

Step 3 — TRANSCRIBE
  Input:  extractedAudioKey (WAV in Tigris)
  Action: Download WAV → Send to AssemblyAI with word_timestamps=true
          → Poll for completion → Store JSON transcript
  Output: transcriptJson on Translation (array of segments with word timings)
  Skip if: transcriptJson already exists

Step 4 — TRANSLATE
  Input:  transcriptJson
  Action: Send segments to GPT-4o-mini with system prompt:
          "Translate the following transcript segments to {targetLanguage}.
           Preserve the segment structure and numbering.
           Adapt idioms naturally. Keep the same tone."
          → Store translated segments with original timing
  Output: translatedJson on Translation
  Skip if: translatedJson already exists

Step 5 — CLONE_VOICE
  Input:  extractedAudioKey (source audio for voice sample)
  Action: Extract first 15–30 seconds of clean speech
          → Send to Fish Audio voice clone endpoint
          → Store returned voice model ID
  Output: fishAudioVoiceId on Translation
  Skip if: fishAudioVoiceId already exists (reuse across translations of same video)

Step 6 — SYNTHESIZE
  Input:  translatedJson + fishAudioVoiceId
  Action: For each segment:
            → Call Fish Audio TTS with cloned voice + translated text
            → Time-stretch result with FFmpeg atempo to match original segment duration
          → Concatenate all segments with correct silence gaps
          → Upload final audio to Tigris
  Output: synthesizedAudioKey on Translation
  Skip if: synthesizedAudioKey already exists

Step 7 — MERGE
  Input:  storageKey (source video) + synthesizedAudioKey
  Action: Download both from Tigris to /tmp
          → FFmpeg: strip original audio, mux new audio track
          → Upload final video to Tigris
  Output: resultVideoKey on Translation, status → COMPLETED
  Skip if: resultVideoKey already exists
```

---

## Build order

Build in this exact order. Each phase is a deployable milestone — the app works (with limited functionality) after every phase.

### Phase 1 — Skeleton (days 1–2)

Set up the project foundation. No features yet, just the bones.

- [ ] Initialize React Router v7 project with TypeScript
- [ ] Set up Tailwind CSS v4
- [ ] Create Supabase project (dashboard → new project)
- [ ] Configure Prisma with Supabase PostgreSQL (pooler URL as `url`, direct URL as `directUrl`)
- [ ] Write the full Prisma schema (all models, enums)
- [ ] Run initial migration via `directUrl`
- [ ] Run the profile creation trigger SQL in Supabase SQL Editor
- [ ] Create `app/utils/env.server.ts` — validate all required env vars at startup
- [ ] Create `app/utils/errors.ts` — define custom error classes
- [ ] Create `app/utils/validation.ts` — Zod schemas for login, register, video submit
- [ ] Install `@supabase/ssr` and `@supabase/supabase-js`
- [ ] Create `app/services/supabase.server.ts` — client factory + admin client
- [ ] Set up `fly.toml` with two processes: `web` and `worker`
- [ ] Create Dockerfile (multi-stage: build + run, include ffmpeg + yt-dlp binaries)
- [ ] Deploy empty shell to Fly.io to confirm infra works

### Phase 2 — Auth + route structure (days 3–4)

Users can register, log in (email + OAuth), and see an empty dashboard.

- [ ] Configure Supabase Auth providers in dashboard (email/password + Google OAuth at minimum)
- [ ] Set Supabase redirect URLs to `{APP_URL}/login/callback`
- [ ] Build auth middleware (`app/middleware/auth.ts`, `app/middleware/admin.ts`) using `requireAuth` / `requireAdmin` pattern
- [ ] Wire up `routes.ts` with all four route groups (site, login, platform, admin)
- [ ] Build login routes: `/login` (email + OAuth buttons), `/register`, `/forgot-password`
- [ ] Build `/login/callback` — handle OAuth code exchange and magic link redirects
- [ ] Build `/logout` (POST only — calls `supabase.auth.signOut()`, clears cookies, redirects)
- [ ] Build site routes: `/` (landing page), `/pricing`, `/about`
- [ ] Build platform layout with sidebar navigation
- [ ] Build `/platform` (empty dashboard)
- [ ] Build `/admin` (empty admin dashboard)
- [ ] Confirm route protection: unauthenticated users get redirected, non-admins can't access `/admin`
- [ ] Manually set one user's Profile role to `ADMIN` via Supabase SQL Editor for testing

### Phase 3 — Storage + video upload (days 5–6)

Users can upload a video or paste a URL. Video shows in their dashboard.

- [ ] Create Tigris bucket on Fly.io (`fly storage create`)
- [ ] Build `app/services/tigris.server.ts` — upload, download, presignedUrl, delete (uses `@aws-sdk/client-s3`)
- [ ] Build `POST /api/upload` — returns presigned Tigris URL for direct client upload
- [ ] Build `app/hooks/use-upload.ts` — handle file selection, upload progress, completion
- [ ] Build `app/components/upload-zone.tsx` — drag-and-drop + file picker
- [ ] Build `app/components/url-input.tsx` — paste URL + platform auto-detection
- [ ] Build `app/utils/url.ts` — parse and validate YouTube/Instagram/Facebook/Vimeo URLs
- [ ] Build `GET/POST /platform/new` — the "New Translation" page (upload or paste URL, select language)
- [ ] Build `app/components/language-selector.tsx` — searchable dropdown of supported languages
- [ ] Build `GET /platform/translations` — list all translations for current user
- [ ] Build `app/components/translation-card.tsx` — show status, language, date, thumbnail
- [ ] On form submit: create Video + Translation records in DB, return to translations list

### Phase 4 — Worker + pipeline foundation (days 7–9)

Jobs get picked up and processed. Start with download + extract only.

- [ ] Build `app/services/worker.server.ts` — pg-boss init using `DIRECT_DATABASE_URL` (not pooler)
- [ ] Build `worker.ts` entrypoint — starts pg-boss, listens for `translation:process` jobs
- [ ] Build `app/services/pipeline.server.ts` — orchestrator that runs steps sequentially
- [ ] Build `app/services/ytdlp.server.ts` — download video from URL via child_process
- [ ] Build `app/services/ffmpeg.server.ts` — extract audio, merge audio, time-stretch
- [ ] Wire Phase 3 form submission to enqueue a pg-boss job
- [ ] Implement steps 1 (DOWNLOAD) and 2 (EXTRACT_AUDIO)
- [ ] Write status update logic: each step updates Translation.status, currentStep, progress
- [ ] Build `GET /api/jobs/:id/status` — returns current status + progress as JSON
- [ ] Build `app/hooks/use-polling.ts` — poll status endpoint every 3 seconds
- [ ] Build `app/components/translation-progress.tsx` — show step-by-step progress
- [ ] Build `GET /platform/translations/:id` — detail page with progress and video player
- [ ] Test end-to-end: upload video → job picks it up → audio extracted → progress updates in UI

### Phase 5 — Transcription + translation (days 10–12)

Videos get transcribed and translated. Users can see the transcript.

- [ ] Build `app/services/assemblyai.server.ts` — submit audio, poll for result, parse word timestamps
- [ ] Implement step 3 (TRANSCRIBE) in pipeline — send extracted audio to AssemblyAI, store transcript JSON
- [ ] Build `app/services/openai.server.ts` — translate segments via GPT-4o-mini
- [ ] Design the translation prompt: preserve segment structure, handle idioms, maintain tone
- [ ] Implement step 4 (TRANSLATE) in pipeline — translate all segments, store translated JSON
- [ ] Display original transcript + translated transcript on the translation detail page
- [ ] Test: upload → download → extract → transcribe → translate → see results in UI

### Phase 6 — Voice cloning + synthesis (days 13–16)

The core feature. Translated speech is generated with the original speaker's voice.

- [ ] Build `app/services/fish-audio.server.ts` — clone voice, generate speech, list voices
- [ ] Implement step 5 (CLONE_VOICE) — extract clean speech sample, create Fish Audio voice model
- [ ] Implement step 6 (SYNTHESIZE) — for each segment: generate TTS → time-stretch to match original duration → concatenate with silence gaps
- [ ] Handle edge cases: segments where translated text is 30%+ longer/shorter than original (adjust atempo limits, split if needed)
- [ ] Implement step 7 (MERGE) — FFmpeg mux synthesized audio onto original video
- [ ] Generate presigned URL for the result video
- [ ] Build video player on translation detail page — play original vs. translated side by side
- [ ] Test full pipeline end-to-end with real videos in multiple language pairs

### Phase 7 — Polish + error handling (days 17–19)

Make it reliable and usable.

- [ ] Implement retry logic in pipeline orchestrator (max 3 retries, exponential backoff)
- [ ] Implement idempotent step resumption (check for existing intermediate artifacts)
- [ ] Add graceful shutdown handler in worker (finish current step on SIGTERM)
- [ ] Build admin pages: `/admin/jobs` (list all jobs with filters), `/admin/jobs/:id` (detail + retry button)
- [ ] Build `/admin/users` — list users, view usage
- [ ] Add error states to UI: failed translation card, retry button, error details
- [ ] Add `/tmp` cleanup after every job (success or failure)
- [ ] Add job timeout: kill jobs that run longer than 30 minutes
- [ ] Add basic rate limiting: max 5 concurrent jobs per user
- [ ] Build `/platform/settings` — update name via Supabase Auth `updateUser()`, update profile
- [ ] Build `/platform/dashboard` — show usage stats, recent translations, quota

### Phase 8 — Launch prep (day 20)

- [ ] Write seed script: create admin user via Supabase Admin API, seed test data
- [ ] Set all production env vars in Fly.io
- [ ] Verify Tigris bucket permissions and CORS settings
- [ ] Configure Supabase Auth redirect URLs for production domain
- [ ] Run full pipeline test on production with 3 different source types (upload, YouTube, Vimeo)
- [ ] Add basic analytics (Plausible or PostHog free tier)
- [ ] Write landing page copy and pricing
- [ ] Deploy

---

## Environment variables

```bash
# Supabase
SUPABASE_URL="https://xxxxx.supabase.co"
SUPABASE_PUBLISHABLE_KEY="sb_publishable_..."  # Safe for client — respects RLS
SUPABASE_SERVICE_ROLE_KEY="eyJ..."             # Server-only — bypasses RLS

# Database (both point to Supabase PostgreSQL)
DATABASE_URL="postgresql://...@...pooler.supabase.com:6543/postgres?pgbouncer=true"     # Pooler for web
DIRECT_DATABASE_URL="postgresql://...@...supabase.com:5432/postgres"                     # Direct for migrations + worker

# Tigris (S3-compatible, Fly.io managed)
TIGRIS_ACCESS_KEY_ID=""
TIGRIS_SECRET_ACCESS_KEY=""
TIGRIS_ENDPOINT_URL=""
TIGRIS_BUCKET_NAME="video-translator"
TIGRIS_REGION="auto"

# AssemblyAI
ASSEMBLYAI_API_KEY=""

# OpenAI
OPENAI_API_KEY=""

# Fish Audio
FISH_AUDIO_API_KEY=""

# App
APP_URL="https://your-app.fly.dev"
NODE_ENV="production"
```

---

## Key architectural decisions

**Supabase as the unified backend.** A single Supabase project provides the PostgreSQL database (for Prisma), user authentication (email, OAuth, magic links), and the backing store for pg-boss job queues. This eliminates three separate services (hosted Postgres, auth provider, Redis) and consolidates billing into one dashboard. The free tier includes 500MB database, 50,000 monthly active users, and unlimited API requests — more than enough for an MVP.

**Two Supabase connection strings.** The web server connects through Supabase's connection pooler (port 6543, PgBouncer in transaction mode) for efficient handling of short-lived HTTP request queries. The worker connects directly (port 5432) because pg-boss requires `LISTEN/NOTIFY` for real-time job pickup, which doesn't work through PgBouncer. Prisma's `directUrl` field handles this split cleanly — migrations and introspection always use the direct URL.

**Prisma alongside Supabase, not instead of it.** Supabase provides the database and auth; Prisma provides the schema management, migrations, and type-safe query layer. This avoids writing raw SQL or using Supabase's JS client for complex joins. Supabase's `auth.users` table remains owned by Supabase Auth. The `Profile` table is owned by Prisma. A database trigger bridges the two on signup.

**Monolith with a separate worker process.** The web server and worker share the same codebase and Docker image but run as separate Fly.io processes. The web server handles HTTP; the worker pulls pg-boss jobs. If the worker crashes, the web app stays up. If the web app gets redeployed, the worker finishes its current step before restarting.

**pg-boss over Supabase native Queues.** Supabase offers pgmq-based Queues, but pg-boss provides superior TypeScript DX: typed job payloads, built-in exponential backoff, completion/failure callbacks, dead-letter queues, and monitoring — all through a Node.js API. Since both use the same PostgreSQL instance, there's no infrastructure difference. pg-boss is the pragmatic choice for a Node.js worker.

**Polling over WebSockets/SSE for progress.** The translation detail page polls `GET /api/jobs/:id/status` every 3 seconds. This is the simplest approach that works with React Router loaders, requires no additional infrastructure, and handles browser tab sleep/wake gracefully. Supabase Realtime is available as a future upgrade path if polling proves insufficient.

**Sequential pipeline, not microservices.** Each translation runs through 7 sequential steps in a single worker function. This is intentionally simple — no event-driven choreography, no separate queues per step. If a step fails, the orchestrator retries the whole job, skipping completed steps via idempotency checks. This avoids the complexity of distributed state management while the app is finding product-market fit.

**Tigris direct uploads via presigned URLs.** Video files go directly from the user's browser to Tigris, never through the Fly.io web server. This keeps the web process lightweight and avoids Fly.io's request size limits and timeout issues with large file uploads.

**No visual lip sync.** Audiences in most markets accept dubbed audio without lip sync. Adding visual lip sync (Wav2Lip/SadTalker) would require GPU instances running continuously, add 10–15 minutes of processing per video, and produce visible quality degradation. The MVP uses audio-only dubbing with time-stretched segments matched to original timing — the same approach used by most professional dubbing tools as a baseline.

---

## File naming conventions

| What            | Pattern                         | Example                   |
| --------------- | ------------------------------- | ------------------------- |
| Route files     | `kebab-case.tsx`                | `new-translation.tsx`     |
| Service files   | `kebab-case.server.ts`          | `fish-audio.server.ts`    |
| Utility files   | `kebab-case.ts` or `.server.ts` | `env.server.ts`           |
| Type files      | `kebab-case.ts`                 | `translation.ts`          |
| Component files | `kebab-case.tsx`                | `translation-card.tsx`    |
| Hook files      | `use-kebab-case.ts`             | `use-polling.ts`          |
| Test files      | `*.test.ts` / `*.test.tsx`      | `pipeline.server.test.ts` |

---

## Dependency graph (what imports what)

```
routes → services → utils
routes → components
routes → hooks
routes → types
routes → middleware
services → utils
services → types
components → hooks
components → types
components → utils (pure only)
hooks → types
utils → types

NEVER:
services → routes
utils → services
types → anything (types are leaf nodes)
middleware → routes
```
