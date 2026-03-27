---
phase: 5
plan: 1
title: "CosyVoice 3 FastAPI Service"
wave: 1
depends_on: []
files_modified:
  - app/services/cosyvoice.server.ts
files_created:
  - services/cosyvoice-api/Dockerfile
  - services/cosyvoice-api/requirements.txt
  - services/cosyvoice-api/server.py
  - services/cosyvoice-api/scripts/download_model.py
  - services/cosyvoice-api/test_server.py
autonomous: true
requirements_addressed: []
---

# Plan 01: CosyVoice 3 FastAPI Service

<objective>
Implement a self-hosted CosyVoice 3 inference service using Python, FastAPI, and Docker. This service replaces the RunPod Serverless handler built in Phase 4. It loads the `Fun-CosyVoice3-0.5B` model on startup, keeps it in memory, and exposes `GET /health` and `POST /synthesize` endpoints. The synthesize endpoint accepts `multipart/form-data` and returns a valid WAV file.
</objective>

## Tasks

<task id="1">
<title>Create Project Structure & Dependencies</title>
<action>
Create `services/cosyvoice-api/requirements.txt`:
```text
fastapi==0.111.0
uvicorn==0.30.1
python-multipart==0.0.9
huggingface_hub>=0.23.0
```

Create `services/cosyvoice-api/scripts/download_model.py`:
```python
import os
from huggingface_hub import snapshot_download

MODEL_DIR = os.environ.get("MODEL_DIR", "/workspace/pretrained_models/Fun-CosyVoice3-0.5B")
snapshot_download(repo_id="FunAudioLLM/CosyVoice3-0.5B", local_dir=MODEL_DIR)
print(f"Model downloaded to {MODEL_DIR}")
```
</action>
<acceptance_criteria>
- `requirements.txt` contains fastapi, uvicorn, python-multipart, huggingface_hub
- `download_model.py` uses `snapshot_download` to fetch `FunAudioLLM/CosyVoice3-0.5B`
</acceptance_criteria>
</task>

<task id="2">
<title>Create Dockerfile (CUDA 12.4.1 + Conda)</title>
<action>
Create `services/cosyvoice-api/Dockerfile` exactly per user specs:
1. Base: `nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04`
2. Apt deps: `git git-lfs build-essential ffmpeg sox libsox-dev wget`
3. Install Miniforge
4. Conda env: `python=3.10 pynini=2.1.5`
5. Clone CosyVoice
6. Pip install CosyVoice requirements
7. Pip install FastAPI requirements
8. Download model
9. Set PYTHONPATH to `/workspace/CosyVoice:/workspace/CosyVoice/third_party/Matcha-TTS`
10. Expose 50000 and run `uvicorn server:app --host 0.0.0.0 --port 50000 --workers 1`

```dockerfile
FROM nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04

WORKDIR /workspace

# 1. System dependencies
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    git git-lfs build-essential ffmpeg sox libsox-dev wget curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Miniforge
RUN curl -L -O "https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-$(uname)-$(uname -m).sh" \
    && bash Miniforge3-$(uname)-$(uname -m).sh -b -p /opt/conda \
    && rm Miniforge3-$(uname)-$(uname -m).sh
ENV PATH="/opt/conda/bin:$PATH"

# 3. Create conda environment
RUN conda create -n cosyvoice python=3.10 pynini=2.1.5 -c conda-forge -y
ENV PATH="/opt/conda/envs/cosyvoice/bin:$PATH"

# 4. Clone CosyVoice
RUN git clone --recursive https://github.com/FunAudioLLM/CosyVoice.git

# 5. Pipeline dependencies (order matters for caching)
RUN pip install --no-cache-dir -r CosyVoice/requirements.txt

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 6. Bake model into image
COPY scripts/download_model.py scripts/
RUN python scripts/download_model.py

# 7. Setup runtime
COPY server.py .
ENV PYTHONPATH="/workspace/CosyVoice:/workspace/CosyVoice/third_party/Matcha-TTS"

EXPOSE 50000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "50000", "--workers", "1"]
```
</action>
<acceptance_criteria>
- Base image is `nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04`
- Conda installed with Python 3.10 and `pynini=2.1.5`
- CosyVoice cloned
- Model downloaded during build layer
- `PYTHONPATH` includes both `CosyVoice` and `Matcha-TTS`
</acceptance_criteria>
</task>

<task id="3">
<title>Create FastAPI Server (server.py)</title>
<action>
Create `services/cosyvoice-api/server.py`.

Implement:
1. Model loading singleton on startup (with warmup inference).
2. `GET /health` returning status and model name.
3. `POST /synthesize`:
   - Validate file (1-30s).
   - Read multipart fields (`text`, `mode`, `reference_audio`, `reference_text`, `speed`).
   - Save upload to temp WAV file.
   - Run `inference_cross_lingual` or `inference_zero_shot`.
   - Convert tensor to WAV via `torchaudio.save` to `io.BytesIO()`.
   - Return `StreamingResponse(wav_io, media_type="audio/wav")`.
   - Clean up temp file in `finally` block!
4. Status codes: 400 for bad input, 500 for inference failures. Return JSON `{"error": ...}`.
</action>
<acceptance_criteria>
- Contains FastAPI app with `/health` and `/synthesize` routes.
- `from cosyvoice.cli.cosyvoice import AutoModel` works due to PYTHONPATH.
- Model loaded globally and warmed up before starting accepting traffic.
- Endpoint uses `torchaudio.save` to create WAV header and returns it.
- Temp audio file cleaned up reliably.
</acceptance_criteria>
</task>

<task id="4">
<title>Create local test script</title>
<action>
Create `services/cosyvoice-api/test_server.py`:
```python
import sys
import requests

SERVER_URL = "http://localhost:50000"

def test_synthesize(wav_path):
    print("Testing /health ...")
    r = requests.get(f"{SERVER_URL}/health")
    print(r.json())

    print("Testing /synthesize (cross_lingual) ...")
    with open(wav_path, "rb") as f:
        files = {"reference_audio": ("ref.wav", f, "audio/wav")}
        data = {
            "text": "Hello, this is a test from the new FastAPI server.",
            "mode": "cross_lingual",
            "speed": 1.0
        }
        res = requests.post(f"{SERVER_URL}/synthesize", files=files, data=data)

    if res.status_code == 200:
        with open("output.wav", "wb") as out:
            out.write(res.content)
        print("Success! Saved output.wav (play with ffplay output.wav)")
    else:
        print(f"Error {res.status_code}: {res.text}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        test_synthesize(sys.argv[1])
    else:
        print("Usage: python test_server.py <reference.wav>")
```
</action>
<acceptance_criteria>
- Local test script POSTs multipart data to `/synthesize`.
- Expects raw WAV binary response.
</acceptance_criteria>
</task>

<task id="5">
<title>Update cosyvoice.server.ts for FastAPI</title>
<read_first>
- `app/services/cosyvoice.server.ts`
</read_first>
<action>
Revert the Phase 4 JSON payload approach and match the FastAPI multipart/form-data schema and `/synthesize` path.

Key changes:
1. Endpoint path becomes `${env.COSYVOICE_URL}/synthesize`.
2. Body is `FormData`.
3. Append fields: `text`, `mode`, `speed`, and `reference_audio` (as a `Blob` named `reference.wav`).
4. If `zero_shot`, append `reference_text` WITH the prefix: `You are a helpful assistant.<|endofprompt|>${promptText}`.
5. Fetch response `.arrayBuffer()` is already a valid WAV file with headers (the FastAPI service uses `torchaudio.save()`). Remove the `pcmToWav` custom function entirely since it's redundant now. Just return `Buffer.from(await res.arrayBuffer())`.
</action>
<acceptance_criteria>
- Client POSTs `FormData` to `/synthesize`.
- Expects `res.arrayBuffer()` directly (no `pcmToWav` needed).
- `reference_audio` sent as Blob, not base64.
- Prefix correctly prepended to `reference_text` for `zero_shot`.
</acceptance_criteria>
</task>

## Verification

```bash
# Wait for Docker image build and start
# Verify cosyvoice.server.ts compiles
npx tsc --noEmit
```

## must_haves

- FastAPI service loads CosyVoice 3 model exactly once globally.
- Inference runs on GPU (CUDA 12).
- `/synthesize` receives multipart, returns proper binary WAV file (not PCM).
- Temp audio files are properly cleaned up.
- Node.js client adapted to new API contract.
