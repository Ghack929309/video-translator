# Technology Stack

## Runtime & Language
- **Runtime:** Node.js 25 (`.nvmrc`)
- **Language:** TypeScript (strict mode, ES2022 target, bundler module resolution)
- **Module System:** ESM (`"type": "module"` in `package.json`)

## Framework
- **React Router v7** (7.13.1) — full-stack SSR framework (formerly Remix)
  - SSR enabled (`ssr: true` in `react-router.config.ts`)
  - File-based routing via `app/routes.ts` with `index`, `layout`, `route` helpers
  - Type-safe loaders/actions via `.react-router/types` codegen
- **React 19** + React DOM 19
- **Vite 7** — bundler (`vite.config.ts`)
  - Plugins: `@tailwindcss/vite`, `reactRouter()`, `tsconfigPaths()`

## Styling
- **Tailwind CSS v4** (4.2.1) — via `@tailwindcss/vite` plugin
  - CSS entry: `app/app.css` (imports `tailwindcss`, `tw-animate-css`, `shadcn/tailwind.css`)
  - Custom variant: `@custom-variant dark (&:is(.dark *))`
  - Dark-first design (html `class="dark"`)
- **Shadcn UI v4** (radix-nova style variant)
  - Config: `components.json` (RSC disabled, `radix-ui` primitives)
  - Components: `app/components/ui/` (20+ components)
  - Icon library: `lucide-react`
- **Typography:** Inter (sans), JetBrains Mono (mono), Geist Variable
- **Design tokens:** CSS custom properties with HSL values, purple primary (`hsl(262 83% 58%)`)

## Database & ORM
- **PostgreSQL** (Supabase-hosted)
  - Two connection modes: transaction pooler (port 6543) + direct (port 5432)
- **Prisma 7** with `@prisma/adapter-pg` (PrismaPg adapter)
  - Schema: `prisma/schema.prisma`
  - Generated client: `prisma/prisma/` (custom output dir)
  - Migrations: `prisma/migrations/`
  - Config: `prisma.config.ts` (uses `DIRECT_DATABASE_URL` for migrations)

## Authentication
- **Supabase Auth** via `@supabase/ssr` (cookie-based SSR auth)
  - Request-scoped client: `app/services/supabase.server.ts`
  - Admin client: uses `SUPABASE_SECRET_KEY` (bypasses RLS)
  - Auth middleware: `app/services/middleware/auth.ts`

## Object Storage
- **Tigris** (S3-compatible, on Fly.io) via `@aws-sdk/client-s3`
  - Service: `app/services/tigris.server.ts`
  - Presigned upload/download URLs, direct upload/download, CORS config

## AI / ML Services
- **AssemblyAI** — speech-to-text transcription with word-level timestamps and speaker diarization
- **OpenAI** (GPT-4o-mini) — segment-level text translation with structured output (Zod schema)
- **Fish Audio** (S2 Pro model) — voice cloning + cross-lingual TTS synthesis

## Media Processing
- **FFmpeg** (`ffmpeg-static` + `fluent-ffmpeg`) — audio extraction, time-stretching, merging, concatenation, silence generation
- **yt-dlp** (Python CLI) — video download from YouTube, Instagram, Facebook, Vimeo

## Job Queue
- **pgmq** (Supabase Queue) — PostgreSQL-native message queue
  - Queue name: `translation_process`
  - Worker: standalone Node.js process (`worker.ts`)

## Validation
- **Zod v4** — environment variable validation (`app/utils/env.server.ts`), OpenAI structured output schemas

## Deployment
- **Fly.io** (`fly.toml`)
  - Region: `iad` (US East)
  - Two processes: `web` (react-router-serve) + `worker` (job processor)
  - VM: shared CPU, 512MB RAM
- **Docker** (multi-stage build, `node:20-alpine` base)
  - Installs: ffmpeg, python3, yt-dlp

## Dev Tools
- **TypeScript** (5.9.3) — strict mode
- **Path aliases:** `~/` → `./app/*`
- **vite-tsconfig-paths** — resolves TS path aliases in Vite
