# Stack Research — CosyVoice 3 Integration

## Recommended Stack (Subsequent Milestone)

### CosyVoice 3 Service Module
- **Model:** `Fun-CosyVoice3-0.5B-2512` (Apache 2.0, 0.5B params)
- **Deployment:** Self-hosted FastAPI endpoint on RunPod Serverless
- **Client:** HTTP fetch from Fly.io worker (multipart/form-data)
- **Output:** Raw PCM int16, 24kHz mono → wrap in WAV header before FFmpeg

### RunPod Serverless
- Docker image with NVIDIA GPU runtime (8GB+ VRAM)
- Set min workers = 0 for cost efficiency (cold starts acceptable)
- Health check route for readiness detection
- Pre-built images available (e.g., `neosun/cosyvoice`) or custom Dockerfile from official repo

### Speaker Diarization Improvements
- **AssemblyAI `speakers_expected` parameter** — provide expected speaker count for better accuracy
- **Recent improvements:** 13% greater accuracy, 85.4% reduction in speaker count errors
- **New speaker embedding model:** 30% better in noisy conditions
- Keep existing `smoothSpeakerLabels` post-processing, enhance with confidence-based filtering

### Database Schema Updates
- **Prisma:** Add `ttsEngine` field to `Translation` model (enum: `FISH_AUDIO`, `COSYVOICE`)
- Update `PipelineStep` enum if needed

### UI Changes
- **New translation form:** Add TTS engine selector (radio/select)
- **Language dropdown:** Filter options dynamically based on selected engine
- CosyVoice: EN, ZH, JA, KO, DE, ES, FR, IT, RU (9 languages)
- Fish Audio: all 21 languages

## What NOT to Change
- AssemblyAI transcription pipeline (works well, just tune diarization params)
- OpenAI translation service (language-agnostic, no changes needed)
- Tigris storage patterns (same key structure)
- Worker/queue architecture (same pgmq flow)
- FFmpeg audio processing (just add PCM→WAV conversion)
