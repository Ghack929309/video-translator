---
phase: 4
plan: 1
title: "CosyVoice 3 RunPod Handler & Dockerfile"
wave: 1
depends_on: []
files_modified: []
files_created:
  - services/cosyvoice-api/handler.py
  - services/cosyvoice-api/Dockerfile
  - services/cosyvoice-api/requirements.txt
  - services/cosyvoice-api/test_handler.py
  - services/cosyvoice-api/README.md
  - services/cosyvoice-api/.dockerignore
autonomous: true
requirements_addressed: []
---

# Plan 01: CosyVoice 3 RunPod Handler & Dockerfile

<objective>
Create the self-hosted CosyVoice 3 inference service as a RunPod Serverless Handler. This is a Python service in `services/cosyvoice-api/` that loads the `Fun-CosyVoice3-0.5B` model and processes TTS requests. The service returns raw PCM audio that `cosyvoice.server.ts` (Phase 1) consumes.

**Critical finding from research:** CosyVoice3's `inference_cross_lingual()` expects the text to be prefixed with `You are a helpful assistant.<|endofprompt|>`, and the model returns a generator of `{'tts_speech': tensor}` chunks. Our Phase 1 client sends multipart/form-data, but RunPod Serverless uses JSON I/O with base64 encoding. The handler must accept base64-encoded prompt WAV and return base64-encoded PCM.
</objective>

## Tasks

<task id="1">
<title>Create handler.py — RunPod Serverless Handler</title>
<read_first>
- CosyVoice3 example: `AutoModel(model_dir=...)`, `inference_cross_lingual(prefix+text, wav, stream=False)`, `inference_zero_shot(text, prefix+prompt_text, wav, stream=False)`
- RunPod handler: `def handler(job): ... return {"output": ...}` + `runpod.serverless.start({"handler": handler})`
</read_first>
<action>
Create `services/cosyvoice-api/handler.py`:

```python
"""
CosyVoice 3 TTS — RunPod Serverless Handler

Loads Fun-CosyVoice3-0.5B model on cold start.
Accepts JSON requests with base64-encoded reference audio.
Returns base64-encoded raw PCM (24kHz, mono, int16).

Local testing: python handler.py --rp_serve_api --rp_api_port 8000
"""

import os
import sys
import base64
import tempfile
import struct
import traceback

import torch
import torchaudio
import numpy as np
import runpod

# ── Model Loading (runs once on cold start) ─────────────────────

MODEL_SOURCE = os.environ.get("MODEL_SOURCE", "huggingface")
MODEL_DIR = os.environ.get("MODEL_DIR", "pretrained_models/Fun-CosyVoice3-0.5B")

SYSTEM_PREFIX = "You are a helpful assistant.<|endofprompt|>"
SAMPLE_RATE = 24000

# Add CosyVoice to path
sys.path.append("third_party/Matcha-TTS")
from cosyvoice.cli.cosyvoice import AutoModel

print("[cosyvoice-api] Loading model...")

if MODEL_SOURCE == "huggingface":
    # Dev: download from HuggingFace (cached)
    from huggingface_hub import snapshot_download
    model_path = snapshot_download(
        repo_id="FunAudioLLM/CosyVoice3-0.5B",
        local_dir=MODEL_DIR,
    )
    model = AutoModel(model_dir=model_path)
elif MODEL_SOURCE == "volume":
    # Prod: load from RunPod network volume
    volume_path = os.environ.get("VOLUME_MODEL_PATH", "/runpod-volume/models/Fun-CosyVoice3-0.5B")
    model = AutoModel(model_dir=volume_path)
else:
    raise ValueError(f"Unknown MODEL_SOURCE: {MODEL_SOURCE}")

print(f"[cosyvoice-api] Model loaded (source: {MODEL_SOURCE}, sample_rate: {model.sample_rate})")


# ── Handler ─────────────────────────────────────────────────────

def handler(job):
    """
    Process TTS inference request.

    Input JSON:
    {
        "tts_text": "Hello world",
        "mode": "cross_lingual" | "zero_shot",
        "prompt_wav": "<base64-encoded WAV bytes>",
        "prompt_text": "optional transcript for zero_shot",
        "speed": 1.0
    }

    Returns:
    {
        "audio": "<base64-encoded raw PCM int16 bytes>",
        "sample_rate": 24000,
        "duration_sec": 1.23
    }
    """
    try:
        job_input = job["input"]

        # Validate required fields
        tts_text = job_input.get("tts_text", "").strip()
        if not tts_text:
            return {"error": "Missing or empty 'tts_text'"}

        mode = job_input.get("mode", "cross_lingual")
        if mode not in ("cross_lingual", "zero_shot"):
            return {"error": f"Invalid mode '{mode}'. Must be 'cross_lingual' or 'zero_shot'"}

        prompt_wav_b64 = job_input.get("prompt_wav")
        if not prompt_wav_b64:
            return {"error": "Missing 'prompt_wav' (base64-encoded WAV)"}

        speed = float(job_input.get("speed", 1.0))
        speed = max(0.5, min(2.0, speed))

        # Decode prompt WAV to temp file
        prompt_wav_bytes = base64.b64decode(prompt_wav_b64)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(prompt_wav_bytes)
            prompt_wav_path = f.name

        try:
            # Run inference based on mode
            if mode == "cross_lingual":
                # CosyVoice3 cross_lingual: prefix goes before tts_text
                prefixed_text = f"{SYSTEM_PREFIX}{tts_text}"
                output_gen = model.inference_cross_lingual(
                    prefixed_text,
                    prompt_wav_path,
                    stream=False,
                    speed=speed,
                )
            else:
                # CosyVoice3 zero_shot: prefix goes before prompt_text
                prompt_text = job_input.get("prompt_text", "")
                prefixed_prompt = f"{SYSTEM_PREFIX}{prompt_text}"
                output_gen = model.inference_zero_shot(
                    tts_text,
                    prefixed_prompt,
                    prompt_wav_path,
                    stream=False,
                    speed=speed,
                )

            # Collect all chunks from generator
            all_speech = []
            for chunk in output_gen:
                all_speech.append(chunk["tts_speech"])

            if not all_speech:
                return {"error": "Model returned no audio"}

            # Concatenate chunks and convert to PCM int16
            speech_tensor = torch.cat(all_speech, dim=1)  # [1, samples]
            speech_np = speech_tensor.squeeze(0).cpu().numpy()

            # Normalize to int16 range
            speech_np = np.clip(speech_np, -1.0, 1.0)
            pcm_int16 = (speech_np * 32767).astype(np.int16)

            # Encode as base64
            pcm_bytes = pcm_int16.tobytes()
            audio_b64 = base64.b64encode(pcm_bytes).decode("ascii")

            duration_sec = len(pcm_int16) / SAMPLE_RATE

            print(f"[cosyvoice-api] Synthesized {duration_sec:.2f}s ({len(pcm_bytes)} bytes, mode: {mode})")

            return {
                "audio": audio_b64,
                "sample_rate": SAMPLE_RATE,
                "duration_sec": round(duration_sec, 3),
            }

        finally:
            # Clean up temp file
            os.unlink(prompt_wav_path)

    except Exception as e:
        error_trace = traceback.format_exc()
        print(f"[cosyvoice-api] Error: {e}\n{error_trace}")
        return {"error": str(e), "traceback": error_trace}


# ── Start RunPod Worker ─────────────────────────────────────────

runpod.serverless.start({"handler": handler})
```

Key details:
- Model loads globally on cold start (outside handler function)
- `MODEL_SOURCE` env var: `huggingface` for dev, `volume` for prod
- `cross_lingual` mode prepends `SYSTEM_PREFIX` to `tts_text`
- `zero_shot` mode prepends `SYSTEM_PREFIX` to `prompt_text`
- Returns base64-encoded raw PCM int16 (no WAV header — client handles that)
- Temp file cleanup in finally block
- Local testing: `python handler.py --rp_serve_api --rp_api_port 8000`
</action>
<acceptance_criteria>
- `handler.py` exists in `services/cosyvoice-api/`
- Contains RunPod handler with `runpod.serverless.start()`
- Model loads globally outside handler
- Supports `cross_lingual` and `zero_shot` modes
- Returns base64-encoded PCM with sample_rate and duration
- `SYSTEM_PREFIX` prepended correctly per mode
- Error handling with traceback
</acceptance_criteria>
</task>

<task id="2">
<title>Create Dockerfile for CUDA + CosyVoice</title>
<action>
Create `services/cosyvoice-api/Dockerfile`:

```dockerfile
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

WORKDIR /app

# System deps for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    sox \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Clone CosyVoice repo (includes model code + Matcha-TTS)
RUN git clone --depth 1 https://github.com/FunAudioLLM/CosyVoice.git /app/cosyvoice-repo

# Install CosyVoice dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Set up CosyVoice code paths
RUN ln -s /app/cosyvoice-repo/cosyvoice /app/cosyvoice && \
    ln -s /app/cosyvoice-repo/third_party /app/third_party

# Copy handler
COPY handler.py .

# For RunPod volume mount point
RUN mkdir -p /runpod-volume

ENV PYTHONPATH=/app:/app/cosyvoice-repo
ENV MODEL_SOURCE=volume
ENV VOLUME_MODEL_PATH=/runpod-volume/models/Fun-CosyVoice3-0.5B

CMD ["python", "-u", "handler.py"]
```
</action>
<acceptance_criteria>
- Dockerfile uses CUDA-enabled PyTorch base image
- Installs audio processing system deps
- Clones CosyVoice repo for model code
- Sets up Python path for cosyvoice imports
- Default `MODEL_SOURCE=volume` for prod
- CMD runs handler.py
</acceptance_criteria>
</task>

<task id="3">
<title>Create requirements.txt</title>
<action>
Create `services/cosyvoice-api/requirements.txt`:

```
runpod>=1.7.0
torchaudio>=2.4.0
numpy>=1.24.0
huggingface_hub>=0.20.0
conformer>=0.3.2
diffusers>=0.28.0
onnxruntime-gpu>=1.16.0
openai-whisper>=20231117
pydub>=0.25.1
soundfile>=0.12.1
librosa>=0.10.0
inflect>=7.0.0
ttsfrd==0.3.6
```

Note: Exact versions may need adjustment based on CosyVoice repo's own requirements.txt — agent should cross-reference during execution.
</action>
<acceptance_criteria>
- `requirements.txt` exists with runpod, torchaudio, numpy, huggingface_hub
- Includes CosyVoice-specific deps (conformer, diffusers, etc.)
</acceptance_criteria>
</task>

<task id="4">
<title>Create test_handler.py for local testing</title>
<action>
Create `services/cosyvoice-api/test_handler.py`:

```python
"""
Local test for CosyVoice handler.
Sends a test request to the local RunPod server.

Usage:
  1. Start handler: python handler.py --rp_serve_api --rp_api_port 8000
  2. Run test: python test_handler.py
"""

import base64
import json
import sys
import requests

SERVER_URL = "http://localhost:8000"

def test_cross_lingual():
    """Test cross-lingual synthesis with a sample WAV."""
    # Use a sample WAV file (provide your own reference audio)
    wav_path = sys.argv[1] if len(sys.argv) > 1 else "test_reference.wav"

    with open(wav_path, "rb") as f:
        wav_b64 = base64.b64encode(f.read()).decode("ascii")

    payload = {
        "input": {
            "tts_text": "Hello, this is a test of the CosyVoice speech synthesis system.",
            "mode": "cross_lingual",
            "prompt_wav": wav_b64,
            "speed": 1.0,
        }
    }

    print(f"Sending cross_lingual request...")
    resp = requests.post(f"{SERVER_URL}/runsync", json=payload)
    result = resp.json()

    if "error" in result.get("output", {}):
        print(f"ERROR: {result['output']['error']}")
        return

    output = result["output"]
    audio_b64 = output["audio"]
    pcm_bytes = base64.b64decode(audio_b64)
    duration = output["duration_sec"]

    print(f"Success: {duration}s audio ({len(pcm_bytes)} bytes PCM)")

    # Save as raw PCM for verification
    with open("test_output.pcm", "wb") as f:
        f.write(pcm_bytes)
    print("Saved to test_output.pcm")
    print(f"Play with: ffplay -f s16le -ar 24000 -ac 1 test_output.pcm")

if __name__ == "__main__":
    test_cross_lingual()
```
</action>
<acceptance_criteria>
- `test_handler.py` sends request to local RunPod server
- Tests cross_lingual mode with base64-encoded WAV
- Saves output PCM for manual verification
- Prints playback command
</acceptance_criteria>
</task>

<task id="5">
<title>Create README.md and .dockerignore</title>
<action>
Create `services/cosyvoice-api/README.md` with setup, local dev, and deployment instructions.

Create `services/cosyvoice-api/.dockerignore`:
```
__pycache__
*.pyc
.git
test_*.py
*.pcm
README.md
```
</action>
<acceptance_criteria>
- README.md covers local setup, testing, and RunPod deployment
- .dockerignore excludes test files and build artifacts
</acceptance_criteria>
</task>

<task id="6">
<title>Update cosyvoice.server.ts to match RunPod JSON API</title>
<read_first>
- app/services/cosyvoice.server.ts — current multipart/form-data client
</read_first>
<action>
Update `cosyvoice.server.ts` to send JSON (with base64 audio) instead of multipart/form-data, matching the RunPod handler's expected input format.

Key changes:
1. Read prompt WAV file, base64-encode it
2. Send JSON POST instead of multipart FormData:
   ```typescript
   const body = JSON.stringify({
     input: {
       tts_text: text,
       mode: mode,
       prompt_wav: wavBase64,
       prompt_text: promptText,
       speed: String(clampedSpeed),
     }
   });
   ```
3. Parse JSON response: `{ output: { audio: "base64", sample_rate: 24000, duration_sec: 1.23 } }`
4. Decode base64 audio to Buffer, then wrap in WAV header
5. Update endpoint path from `/inference` to `/runsync` (RunPod convention)

This aligns the Phase 1 client with the actual RunPod Serverless API format.
</action>
<acceptance_criteria>
- `cosyvoice.server.ts` sends JSON with base64-encoded audio (not multipart)
- Endpoint changed to `/runsync`
- Response parsed as JSON with `output.audio` base64 field
- PCM decoded from base64, then wrapped in WAV header
- All existing functionality preserved (retry, validation, mode selection)
</acceptance_criteria>
</task>

## Verification

```bash
# Files exist
ls -la services/cosyvoice-api/ && echo "PASS: Directory exists"

# Handler has RunPod start
grep -q "runpod.serverless.start" services/cosyvoice-api/handler.py && echo "PASS: RunPod handler"

# Model loading with both sources
grep -q "MODEL_SOURCE" services/cosyvoice-api/handler.py && echo "PASS: Dual model loading"

# CosyVoice3 inference methods
grep -q "inference_cross_lingual" services/cosyvoice-api/handler.py && echo "PASS: cross_lingual"
grep -q "inference_zero_shot" services/cosyvoice-api/handler.py && echo "PASS: zero_shot"

# System prefix
grep -q "endofprompt" services/cosyvoice-api/handler.py && echo "PASS: System prefix"

# Dockerfile
grep -q "cuda" services/cosyvoice-api/Dockerfile && echo "PASS: CUDA base"

# Client updated
grep -q "runsync" app/services/cosyvoice.server.ts && echo "PASS: Client updated"

# TypeScript compiles
npx tsc --noEmit 2>&1 | head -5
```

## must_haves

- Handler loads CosyVoice3 model on cold start (not per-request)
- Supports cross_lingual and zero_shot modes with correct prefix placement
- Returns base64 PCM audio with sample_rate and duration metadata
- Dockerfile uses CUDA base and clones CosyVoice repo
- Client (cosyvoice.server.ts) updated to match RunPod JSON API
- Local testing works via `--rp_serve_api`
