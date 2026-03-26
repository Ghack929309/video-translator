# Testing

## Current State
**No test framework is configured.** The project has:
- No test runner (no Jest, Vitest, or similar in dependencies)
- No test directories or files (only `scripts/test-tigris.ts` — a manual integration test)
- No CI/CD pipeline configuration
- No `test` script in `package.json`

## Manual Testing Script
- `scripts/test-tigris.ts` — manual Tigris S3 connectivity test

## What Should Be Tested
Given the architecture, the following areas would benefit from tests:

### Unit Tests (highest priority)
- **Pipeline step functions** (`pipeline.server.ts`) — each step is self-contained with clear inputs/outputs
- **Speaker label smoothing** (`assemblyai.server.ts`) — pure function with complex logic
- **OpenAI segment mapping** (`openai.server.ts`) — batch translation index alignment
- **Time-stretch ratio calculation** (`ffmpeg.server.ts`) — clamping, chaining atempo filters
- **Env validation** (`env.server.ts`) — Zod schema behavior

### Integration Tests
- **Pipeline resume logic** — verify failed jobs restart from correct step
- **Worker queue flow** — enqueue → poll → process → archive
- **Auth middleware** — requireAuth/requireAdmin behavior

### E2E Tests
- **Upload flow** — file upload → presigned URL → Tigris storage
- **Translation creation** — create translation → enqueue → status polling
- **OAuth callback** — Supabase auth redirect flow

## Recommended Setup
Given the stack (Vite + React Router v7 + TypeScript):
- **Vitest** — native Vite integration, TypeScript support
- **Playwright** — E2E browser testing for auth flows and UI
- **MSW** — mock external APIs (AssemblyAI, OpenAI, Fish Audio) in tests
