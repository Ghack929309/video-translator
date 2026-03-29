# CosyVoice 3 API Service

Self-hosted CosyVoice 3 TTS inference server for RunPod Serverless.

## Architecture

```
cosyvoice.server.ts (Node.js client)
    → POST /runsync (JSON + base64 audio)
    → RunPod Serverless Handler (handler.py)
    → CosyVoice 3 model inference
    → base64 PCM response
```

## Local Development

### Prerequisites

- Python 3.10+
- NVIDIA GPU with 8GB+ VRAM
- CUDA 12.x toolkit

### Setup

```bash
cd services/cosyvoice-api

# Create environment
python -m venv .venv
source .venv/bin/activate

# Install deps
pip install -r requirements.txt

# Clone CosyVoice (for model code)
git clone --depth 1 https://github.com/FunAudioLLM/CosyVoice.git cosyvoice-repo
export PYTHONPATH=$PWD:$PWD/cosyvoice-repo

# Symlink model code
ln -sf cosyvoice-repo/cosyvoice cosyvoice
ln -sf cosyvoice-repo/third_party third_party
```

### Start Server

```bash
# Downloads model from HuggingFace on first run (~1GB, cached)
MODEL_SOURCE=huggingface python handler.py --rp_serve_api --rp_api_port 8000
```

### Test

```bash
python test_handler.py path/to/reference_audio.wav
```

## Production (RunPod Standard On-Demand)

### Build & Push

```bash
# Build the Docker image (this will automatically download and physically bake the CosyVoice model into /app)
docker build -t ghack929309/dubly-cosyvoice-api:latest .

# Push your fresh image to Docker Hub
docker push ghack929309/dubly-cosyvoice-api:latest
```

### RunPod Setup

1. Spin up a new **Secure Cloud Pod**:
   - **Template**: Select your Custom Template or specify the image: `ghack929309/dubly-cosyvoice-api:latest`
   - **GPU**: RTX 4090 or A100 (8GB+ VRAM)
   - **Ports**: Expose `8000` (HTTP)
   - **Volume**: (Optional) You can safely attach a Network Volume to `/workspace`. The models are now securely locked inside `/app` so external volumes will not mask them.

2. Set your orchestrator variables in the Dubly backend `.env`:
   ```env
   RUNPOD_API_KEY=your_runpod_api_token
   RUNPOD_POD_ID=your_pod_instance_id
   COSYVOICE_URL=https://{your_pod_instance_id}-8000.proxy.runpod.net/synthesize
   ```

> **Note:** The Dubly backend automatically manages your hardware. It wakes up the Pod via GraphQL when a translation is requested, routes audio through the 8000 proxy port instantly, and powers the GPU down to save money once finished!

## API

### Request (JSON via `/runsync`)

```json
{
  "input": {
    "tts_text": "Text to synthesize",
    "mode": "cross_lingual",
    "prompt_wav": "<base64 WAV>",
    "prompt_text": "optional (zero_shot only)",
    "speed": 1.0
  }
}
```

### Response

```json
{
  "output": {
    "audio": "<base64 raw PCM int16>",
    "sample_rate": 24000,
    "duration_sec": 2.5
  }
}
```

### Modes

- **cross_lingual** — Speaker timbre from `prompt_wav`, phonology from target language. Best for translation dubbing.
- **zero_shot** — Full voice clone using `prompt_wav` + `prompt_text` transcript. Same language only.

### Supported Languages

EN, ZH, JA, KO, DE, ES, FR, IT, RU

> **Note:** Japanese text must be in katakana for best results.
