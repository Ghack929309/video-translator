# External Integrations

## Supabase (Auth + Database)

**Purpose:** Authentication, user management, PostgreSQL hosting, pgmq queue

### Auth
- **Client:** `@supabase/ssr` (cookie-based SSR sessions)
- **Server:** `app/services/supabase.server.ts`
  - `createSupabaseClient(request, headers)` — request-scoped client for loaders/actions
  - `supabaseAdmin` — admin client with secret key (bypasses RLS)
- **Flow:** Cookie-based auth → `getUser()` → auto-upsert `Profile` record
- **Routes:** `/login`, `/register`, `/forgot-password`, `/reset-password`, `/login/callback`, `/logout`

### Environment Variables
```
SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY
DATABASE_URL (transaction pooler, port 6543)
DIRECT_DATABASE_URL (session pooler, port 5432)
```

---

## Tigris (Object Storage)

**Purpose:** S3-compatible storage for videos, audio files, and processed outputs

- **Client:** `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`
- **Service:** `app/services/tigris.server.ts`
- **Operations:** presigned upload/download URLs, direct upload/download, delete, CORS config
- **Storage patterns:**
  - Source videos: `videos/{videoId}/source.mp4`
  - Extracted audio: `translations/{translationId}/source-audio.wav`
  - Synthesized audio: `translations/{translationId}/synthesized-audio.wav`
  - Result video: `translations/{translationId}/result.mp4`

### Environment Variables
```
TIGRIS_ACCESS_KEY_ID, TIGRIS_SECRET_ACCESS_KEY
TIGRIS_ENDPOINT_URL (https://fly.storage.tigris.dev)
TIGRIS_BUCKET_NAME, TIGRIS_REGION
```

---

## AssemblyAI (Speech-to-Text)

**Purpose:** Transcribe audio with word-level timestamps and speaker diarization

- **Client:** `assemblyai` SDK
- **Service:** `app/services/assemblyai.server.ts`
- **Models:** `universal-3-pro`, `universal-2` (fallback)
- **Features:** Language detection, speaker labels (diarization), word timestamps
- **Post-processing:** Speaker label smoothing (corrects isolated misdetections in short segments)
- **Output:** `TranscriptResult` with segments, words, and auto-detected language code

### Environment Variables
```
ASSEMBLYAI_API_KEY
```

---

## OpenAI (Translation)

**Purpose:** Translate transcript segments to target language

- **Client:** `openai` SDK (v6)
- **Service:** `app/services/openai.server.ts`
- **Model:** `gpt-4o-mini` with structured output (`zodResponseFormat`)
- **Processing:** Batch translation (20 segments/batch) with timing preservation
- **Supports 21 languages:** en, fr, es, de, it, pt, ja, ko, zh, ru, ar, hi, nl, pl, tr, vi, th, id, sv, uk, ht

### Environment Variables
```
OPENAI_API_KEY
```

---

## Fish Audio (Voice Cloning + TTS)

**Purpose:** Clone speaker voices and synthesize translated speech

- **Client:** REST API (`https://api.fish.audio`)
- **Service:** `app/services/fish-audio.server.ts`
- **Model:** S2 Pro (cross-lingual synthesis)
- **Operations:**
  - `createVoiceModel(audioPath, title)` — clone voice from audio sample (fast mode, private)
  - `synthesize(text, referenceId, language, speed)` — generate TTS with cloned voice
  - `deleteModel(modelId)` — cleanup
- **Features:**
  - Native language pronunciation hints per target language
  - Prosody speed control (0.5–2.0x)
  - WAV output validation (RIFF header check)
  - Retry with exponential backoff (max 2 retries)

### Environment Variables
```
FISH_AUDIO_API_KEY
```

---

## yt-dlp (Video Download)

**Purpose:** Download videos from URL sources (YouTube, Instagram, Facebook, Vimeo)

- **Client:** Python CLI executed via `child_process.spawn`
- **Service:** `app/services/ytdlp.server.ts`
- **Config:** Best video ≤1080p (mp4) + best audio (m4a), merged to mp4
- **Output:** Downloaded file in `/tmp/dubly/{videoId}/source.{ext}`

---

## pgmq (Job Queue)

**Purpose:** PostgreSQL-native message queue for async translation processing

- **Client:** Direct `pg.Client` queries against `pgmq.*` functions
- **Service:** `app/services/worker.server.ts`
- **Queue:** `translation_process`
- **Operations:**
  - `ensureQueue(client)` — idempotent queue creation
  - `enqueueTranslation(translationId)` — send job to queue
  - Worker polls via `pgmq.read_with_poll()` with 65-minute visibility timeout
  - Successful jobs archived via `pgmq.archive()`
  - Stale/deleted record jobs auto-archived (P2025 error detection)
