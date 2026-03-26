# Concerns

## Security

### Admin Role Check Disabled
- **File:** `app/services/middleware/auth.ts` (lines 34–36)
- **Issue:** `requireAdmin()` has the role check commented out — any authenticated user can access admin routes (`/admin`, `/admin/users`, `/admin/jobs`)
- **Risk:** High — exposes user management and job monitoring to all users
- **Fix:** Uncomment the role check or implement proper RBAC

### Environment Secrets in Memory
- **Files:** All `*.server.ts` services
- **Issue:** API keys loaded into module-level constants at import time. Not a vulnerability per se, but a surface area consideration for debugging/logging.

## Performance

### Single Worker Process
- **File:** `worker.ts`, `fly.toml`
- **Issue:** Only one worker process handles all translation jobs. Long-running jobs (up to 60 minutes) block the queue for other translations.
- **Impact:** Serialized processing — users wait in queue behind each other
- **Fix:** Scale to multiple worker instances on Fly.io, or implement concurrent processing (poll multiple messages)

### Large File Memory Buffering
- **Files:** `pipeline.server.ts`, `tigris.server.ts`
- **Issue:** Files are read entirely into memory (`fs.readFileSync`) before upload to Tigris. For large videos this could exhaust the 512MB VM memory.
- **Relevant code:**
  - `pipeline.server.ts` line 219: `const fileBuffer = fs.readFileSync(filePath)`
  - `pipeline.server.ts` line 300: `const audioBuffer = fs.readFileSync(audioPath)`
- **Fix:** Use streaming uploads (`Readable` stream → `PutObjectCommand`)

### No Rate Limiting on API Routes
- **Files:** `app/routes/api/upload.ts`, `app/routes/api/jobs-id-status.ts`
- **Issue:** No rate limiting on upload or status polling endpoints
- **Risk:** Potential abuse / cost amplification (each translation triggers paid API calls)

## Reliability

### No Dead Letter Queue
- **File:** `worker.ts`
- **Issue:** Failed messages become visible again after visibility timeout (65 min) and are re-processed indefinitely. While the pipeline has per-step retries (max 3), there's no limit on how many times a message can be re-delivered at the queue level.
- **Fix:** Track retry count in the message and archive after N failures, or use pgmq's dead letter queue features

### No Health Check Endpoint
- **File:** `fly.toml`
- **Issue:** No HTTP health check configured. Fly.io may not detect unhealthy web instances.
- **Fix:** Add `[[services.http_checks]]` in `fly.toml` pointing to a `/health` endpoint

### Temporary File Cleanup on Failure
- **File:** `pipeline.server.ts`
- **Issue:** `ffmpeg.cleanup()` is called in the `finally` block, but intermediate files in `/tmp/dubly/{translationId}/` could accumulate if the worker crashes without cleanup.
- **Mitigation:** Docker containers restart fresh, but on long-running VMs this could fill disk

## Technical Debt

### Dockerfile Uses Node 20, .nvmrc Specifies Node 25
- **Files:** `Dockerfile`, `.nvmrc`
- **Issue:** Version mismatch — local development uses Node 25, production Docker image uses Node 20
- **Fix:** Align Docker base image to `node:25-alpine`

### Mock Data File
- **File:** `app/utils/mock-data.ts`
- **Issue:** Presence suggests some UI components may still use hardcoded data
- **Impact:** Low — likely for development scaffolding

### Billing and Settings Pages
- **Files:** `app/routes/platform/billing.tsx`, `app/routes/platform/settings.tsx`
- **Issue:** Likely placeholder stubs — no payment provider integration visible in dependencies
- **Impact:** Low — future feature scaffolding

## Scalability

### Monolithic Pipeline
- **File:** `app/services/pipeline.server.ts` (883 lines)
- **Issue:** All 7 pipeline steps in a single file. As complexity grows (new languages, new TTS providers, quality checking), this becomes unwieldy.
- **Fix:** Extract each step into its own module under `app/services/pipeline/`

### No Caching Layer
- **Issue:** No Redis or in-memory caching. Every loader/action hits Prisma directly.
- **Impact:** Acceptable at current scale, but may need caching for dashboard/admin pages at higher traffic
