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

## Production (RunPod Serverless)

### Build & Push

```bash
docker build -t your-registry/cosyvoice-api:latest .
docker push your-registry/cosyvoice-api:latest
```

### RunPod Setup

1. Create a **Network Volume** and upload model weights:
   ```
   /runpod-volume/models/Fun-CosyVoice3-0.5B/
   ```

2. Create a **Serverless Endpoint** with:
   - Docker image: `your-registry/cosyvoice-api:latest`
   - GPU: RTX 4090 or A100 (8GB+ VRAM)
   - Volume: Mount your network volume
   - Env: `MODEL_SOURCE=volume`

3. Set `COSYVOICE_URL` in your Dubly `.env`:
   ```
   COSYVOICE_URL=https://api.runpod.ai/v2/{endpoint-id}
   ```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL_SOURCE` | `huggingface` | `huggingface` (dev) or `volume` (prod) |
| `MODEL_DIR` | `pretrained_models/Fun-CosyVoice3-0.5B` | HuggingFace download path |
| `VOLUME_MODEL_PATH` | `/runpod-volume/models/Fun-CosyVoice3-0.5B` | Network volume model path |

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
