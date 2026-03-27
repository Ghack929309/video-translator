# Implement the CosyVoice 3 API Service

## What to build

A Python FastAPI service that wraps CosyVoice 3 (Fun-CosyVoice3-0.5B) and exposes a simple HTTP API for voice-cloned text-to-speech. This service runs on a GPU server inside Docker. It is called by a remote Node.js worker (on Fly.io) that sends reference audio + translated text and receives synthesized audio back.

This is ONE piece of a larger video dubbing app called "Dubly." The Node.js app handles everything else (upload, transcription, translation, FFmpeg processing). This service ONLY does: receive reference audio + text → run CosyVoice 3 inference → return audio.

---

## Tech stack

- **Python 3.10** (strictly required — model dependencies are compiled for 3.10 only)
- **FastAPI** for the HTTP server
- **CosyVoice 3** (`FunAudioLLM/Fun-CosyVoice3-0.5B-2512`) from HuggingFace
- **Docker** with `nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04` base image
- **Conda** for environment management (pynini dependency requires conda-forge)
- **NVIDIA GPU** with 8+ GB VRAM

---

## API endpoints to implement

### `GET /health`

Returns `{"status": "ok", "model": "Fun-CosyVoice3-0.5B"}`. Used by the Node.js worker to check if the service is up before sending jobs.

### `POST /synthesize`

This is the main endpoint. Accepts multipart/form-data, returns a WAV file.

**Request (multipart/form-data):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | Yes | The text to synthesize (in the target language) |
| `mode` | string | Yes | `"cross_lingual"` or `"zero_shot"` |
| `reference_audio` | file (WAV) | Yes | 3–15 seconds of clean speech from the speaker to clone |
| `reference_text` | string | Only for `zero_shot` | Transcript of the reference audio. Must be prefixed with `You are a helpful assistant.<\|endofprompt\|>` |
| `speed` | float | No (default 1.0) | Speech speed multiplier, range 0.5–2.0 |

**Response:** A WAV file (`audio/wav`, 24kHz, mono, 16-bit). NOT raw PCM — this endpoint must return a proper WAV with headers so the Node.js client can use it directly.

**Error response:** JSON `{"error": "message"}` with appropriate HTTP status code.

**Mode behavior:**
- `cross_lingual` → Calls `model.inference_cross_lingual(text, prompt_wav_path, stream=False)`. Extracts only speaker timbre, generates speech using target language's native pronunciation. Use this when source and target languages differ.
- `zero_shot` → Calls `model.inference_zero_shot(text, reference_text, prompt_wav_path, stream=False)`. Preserves more of the speaker's original prosody. Use when source and target language are the same.

---

## Implementation steps

### Step 1 — Project structure

```
cosyvoice-service/
├── Dockerfile
├── server.py            # FastAPI app
├── requirements.txt     # Additional pip deps (fastapi, uvicorn, python-multipart)
└── scripts/
    └── download_model.py  # Downloads model weights from HuggingFace
```

The CosyVoice repo itself is cloned inside the Docker image at build time. You do NOT fork or modify it — you import from it.

### Step 2 — Model loading

Load the model ONCE at startup as a global singleton. Model loading takes 20–60 seconds (CUDA kernel compilation). Do NOT reload per request.

```python
import sys
sys.path.append('/workspace/CosyVoice')
sys.path.append('/workspace/CosyVoice/third_party/Matcha-TTS')
from cosyvoice.cli.cosyvoice import AutoModel

MODEL = AutoModel(model_dir='/workspace/pretrained_models/Fun-CosyVoice3-0.5B')
```

Both `sys.path.append` lines are mandatory. Without the Matcha-TTS path, imports fail silently.

Run a **dummy inference at startup** (warmup) to trigger CUDA kernel compilation so the first real request isn't slow:

```python
# Warmup with a short dummy call
for _ in MODEL.inference_zero_shot(
    "warmup", "You are a helpful assistant.<|endofprompt|>warmup",
    "/workspace/CosyVoice/asset/zero_shot_prompt.wav", stream=False):
    pass
```

### Step 3 — Request handling

For each request:

1. **Save uploaded `reference_audio`** to a temp file (CosyVoice expects a file path, not bytes)
2. **Validate inputs**: text is non-empty, mode is valid, reference audio exists, duration is 3–30 seconds
3. **Call CosyVoice inference** based on mode (see mode behavior above)
4. **Collect output**: the model yields dictionaries with `tts_speech` (a torch tensor). Take the first result.
5. **Convert to WAV**: use `torchaudio.save()` to write the tensor to a BytesIO buffer as WAV format
6. **Return** the WAV bytes as a `StreamingResponse` with `media_type="audio/wav"`
7. **Clean up** the temp file

### Step 4 — Audio preprocessing

CosyVoice 3's internal `load_wav` function auto-resamples to 16kHz and converts to mono, BUT:
- It rejects audio with sample rate < 16kHz (assertion error)
- It truncates at 30 seconds silently
- It does NO noise removal or normalization

The service should validate that the uploaded file is a valid audio file (try loading with torchaudio, catch errors). Do NOT add heavy preprocessing — the Node.js worker handles normalization before sending.

### Step 5 — Docker image

Build order matters for layer caching. The model download (~9.75 GB) should be its own layer so code changes don't re-trigger it.

```
1. Base image: nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04
2. Install system deps: git, git-lfs, build-essential, ffmpeg, sox, libsox-dev, wget
3. Install Miniforge (conda)
4. Create conda env: python=3.10, pynini=2.1.5
5. Clone CosyVoice repo: git clone --recursive https://github.com/FunAudioLLM/CosyVoice.git
6. pip install CosyVoice/requirements.txt
7. pip install fastapi uvicorn python-multipart
8. Download model weights from HuggingFace (this is the ~9.75 GB layer)
9. Set PYTHONPATH to include CosyVoice and CosyVoice/third_party/Matcha-TTS
10. EXPOSE 50000
11. CMD: run server.py with uvicorn
```

**Bake model weights into the image.** Do NOT download at runtime — it adds minutes to every cold start.

### Step 6 — Concurrency and resource limits

- **One request at a time.** CosyVoice saturates one GPU with a single inference. Use a semaphore or set uvicorn `--workers 1`. Do NOT use multiple workers — the model is loaded per-process and 2 copies won't fit in 8GB VRAM.
- **Request timeout: 120 seconds.** A 30-second audio segment takes ~20–40 seconds to generate on RTX 4090. Set timeout accordingly.
- **Temp file cleanup.** Always delete temp files in a `finally` block. The container may have limited disk.

### Step 7 — Error handling

Return JSON errors for:
- Missing or invalid fields → 400
- Audio file can't be loaded → 400 with `"Invalid audio file"`
- Audio too short (< 1 second) → 400 with `"Reference audio too short"`
- Model inference fails (OOM, CUDA error) → 500 with error message
- Request timeout → 504

Log every request: mode, text length, reference duration, inference time, output duration. This is critical for debugging quality issues.

---

## Environment variables

```bash
MODEL_DIR="/workspace/pretrained_models/Fun-CosyVoice3-0.5B"  # Path to model weights
PORT=50000                                                       # Server port
LOG_LEVEL="info"                                                 # Logging level
```

---

## How the Node.js worker calls this service

The Node.js worker (in the Dubly app at `app/services/cosyvoice.server.ts`) does:

```
1. Downloads reference audio WAV from Tigris (extracted earlier in the pipeline)
2. For each translated text segment:
   a. POST /synthesize with reference_audio file + text + mode="cross_lingual"
   b. Receives WAV file back
   c. Time-stretches with FFmpeg atempo to match original segment duration
   d. Saves to Tigris
3. Concatenates all segment WAVs with silence gaps matching original timing
4. Merges final audio track with original video via FFmpeg
```

The service doesn't need to know about Tigris, Supabase, pg-boss, or any other Dubly infrastructure. It just receives audio + text and returns audio.

---

## Key technical facts

- **Output sample rate:** 24,000 Hz (not 22,050 — that's CosyVoice v1)
- **Output format:** mono, 16-bit signed integer
- **Model class:** `AutoModel` (not `CosyVoice` or `CosyVoice2` — those are older versions)
- **Reference audio sweet spot:** 10–15 seconds of clean single-speaker speech
- **Max output per call:** ~27 seconds of audio. Split longer text into multiple calls.
- **Supported languages:** Chinese, English, Japanese, Korean, German, Spanish, French, Italian, Russian
- **License:** Apache 2.0 (commercial use OK)
- **Pronunciation inpainting:** Embed `[phoneme]` brackets in the text to override pronunciation. Chinese uses pinyin (`[j][ǐ]`), English uses CMU format (`[L EH1 S T ER0]`). Works in any mode — just put the brackets in the `text` field.
