# Directory Structure

## Root
```
.
├── app/                        # Application source (React Router v7)
│   ├── app.css                 # Global CSS (Tailwind v4 + Shadcn theme + tokens)
│   ├── root.tsx                # Root layout (HTML shell, providers, error boundary)
│   ├── routes.ts               # Route configuration (explicit, not file-system based)
│   ├── components/             # Shared components
│   │   ├── ui/                 # Shadcn UI primitives (20+ components)
│   │   ├── upload-zone.tsx     # Video upload drag-and-drop zone
│   │   ├── url-input.tsx       # URL input for video sources
│   │   ├── language-selector.tsx # Target language picker
│   │   ├── translation-card.tsx  # Translation status card
│   │   └── translation-progress.tsx # Progress indicator
│   ├── hooks/                  # Custom React hooks
│   │   ├── use-upload.ts       # File upload logic
│   │   └── use-polling.ts      # Job status polling
│   ├── lib/                    # Utility libraries
│   │   └── utils.ts            # Shadcn cn() helper (clsx + tailwind-merge)
│   ├── routes/                 # Page routes (grouped by concern)
│   │   ├── site/               # Public marketing pages
│   │   │   ├── layout.tsx      # Public layout (header/footer)
│   │   │   ├── home.tsx        # Landing page (index)
│   │   │   ├── pricing.tsx     # Pricing page
│   │   │   └── about.tsx       # About page
│   │   ├── login/              # Auth pages
│   │   │   ├── layout.tsx      # Auth layout
│   │   │   ├── login.tsx       # Login form
│   │   │   ├── register.tsx    # Registration form
│   │   │   ├── forgot-password.tsx
│   │   │   ├── reset-password.tsx
│   │   │   ├── callback.tsx    # OAuth callback handler
│   │   │   └── logout.tsx      # Logout action
│   │   ├── platform/           # Authenticated user pages
│   │   │   ├── layout.tsx      # Platform layout (sidebar/nav)
│   │   │   ├── dashboard.tsx   # User dashboard
│   │   │   ├── new-translation.tsx # Create new translation
│   │   │   ├── translations.tsx    # Translation list
│   │   │   ├── translation.tsx     # Single translation detail (:id)
│   │   │   ├── settings.tsx    # User settings
│   │   │   └── billing.tsx     # Billing/subscription
│   │   ├── admin/              # Admin pages
│   │   │   ├── layout.tsx      # Admin layout
│   │   │   ├── dashboard.tsx   # Admin dashboard
│   │   │   ├── users.tsx       # User management
│   │   │   └── jobs.tsx        # Job monitoring
│   │   └── api/                # API routes (no UI)
│   │       ├── upload.ts       # File upload endpoint
│   │       └── jobs-id-status.ts # Job status polling endpoint
│   ├── services/               # Server-side service layer
│   │   ├── middleware/
│   │   │   └── auth.ts         # requireAuth() / requireAdmin()
│   │   ├── db.server.ts        # Prisma client singleton
│   │   ├── supabase.server.ts  # Supabase auth clients
│   │   ├── tigris.server.ts    # S3-compatible storage
│   │   ├── assemblyai.server.ts # Transcription service
│   │   ├── openai.server.ts    # Translation service
│   │   ├── fish-audio.server.ts # Voice cloning + TTS
│   │   ├── ffmpeg.server.ts    # Audio/video processing
│   │   ├── ytdlp.server.ts     # Video download (yt-dlp)
│   │   ├── worker.server.ts    # pgmq queue management
│   │   └── pipeline.server.ts  # Translation pipeline orchestrator
│   └── utils/                  # Server/shared utilities
│       ├── env.server.ts       # Zod env validation
│       ├── validation.ts       # Input validation
│       ├── errors.ts           # Error helpers
│       ├── responses.server.ts # Response helpers
│       ├── url.ts              # URL utilities
│       ├── constants.ts        # App constants
│       └── mock-data.ts        # Development mock data
├── prisma/                     # Database schema + migrations
│   ├── schema.prisma           # Prisma schema (3 models, 4 enums)
│   ├── prisma/                 # Generated client
│   └── migrations/             # SQL migrations
├── public/                     # Static assets
├── scripts/                    # Utility scripts
├── worker.ts                   # Worker entrypoint (runs as separate Fly.io process)
├── vite.config.ts              # Vite configuration
├── react-router.config.ts      # React Router config (SSR: true)
├── prisma.config.ts            # Prisma config (migration URL)
├── tsconfig.json               # TypeScript config
├── components.json             # Shadcn UI config
├── fly.toml                    # Fly.io deployment config
├── Dockerfile                  # Multi-stage Docker build
├── ui.pen                      # Design file (Pencil)
└── .env.example                # Environment variable template
```

## Naming Conventions
- **Server-only files:** `*.server.ts` suffix (React Router convention — excluded from client bundles)
- **Route files:** Named by feature, grouped in folders by access level (`site/`, `login/`, `platform/`, `admin/`, `api/`)
- **UI components:** `app/components/ui/` for Shadcn primitives, `app/components/` for app-specific
- **Services:** One file per external integration, all in `app/services/`
- **Types:** Auto-generated route types in `.react-router/types/`

## Key Files
| File | Lines | Purpose |
|------|-------|---------|
| `app/services/pipeline.server.ts` | 883 | Core pipeline orchestrator — the main business logic |
| `app/services/ffmpeg.server.ts` | 451 | Audio/video processing (8 operations) |
| `app/services/assemblyai.server.ts` | 218 | Transcription + speaker smoothing |
| `app/services/fish-audio.server.ts` | 208 | Voice cloning + TTS |
| `app/services/openai.server.ts` | 169 | Translation with structured output |
| `app/app.css` | 140 | Full theme definition (light + dark) |
| `worker.ts` | 96 | Worker process entrypoint |
| `prisma/schema.prisma` | 89 | Data model (3 models, 4 enums) |
