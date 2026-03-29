import os
import sys
import tempfile
import traceback
import io

from fastapi import FastAPI, UploadFile, Form, File, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse

import torch
import torchaudio

# ── Dynamic Path Resolution (Works in Docker and Locally) ────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
COSYVOICE_REPO_DIR = os.path.join(BASE_DIR, "CosyVoice")

# If the Docker path doesn't exist, assume we are running locally where the repo was cloned
sys.path.append("/app/CosyVoice" if os.path.exists("/app/CosyVoice") else COSYVOICE_REPO_DIR)
sys.path.append("/app/CosyVoice/third_party/Matcha-TTS" if os.path.exists("/app/CosyVoice") else os.path.join(COSYVOICE_REPO_DIR, "third_party", "Matcha-TTS"))

from cosyvoice.cli.cosyvoice import AutoModel

app = FastAPI(title="CosyVoice 3 API Service")

# ── Model Loading (Singleton) ─────────────────────────────────────────────

DEFAULT_MODEL_DIR = "/app/pretrained_models/Fun-CosyVoice3-0.5B" if os.path.exists("/app") else os.path.join(BASE_DIR, "pretrained_models", "Fun-CosyVoice3-0.5B")
MODEL_DIR = os.environ.get("MODEL_DIR", DEFAULT_MODEL_DIR)
print(f"[Starting up] Loading CosyVoice 3 model from {MODEL_DIR}...")

try:
    MODEL = AutoModel(model_dir=MODEL_DIR)
except Exception as e:
    print(f"FAILED to loaded model: {e}")
    sys.exit(1)

print(f"[Model Loaded] Sample rate: {MODEL.sample_rate}")

# ── Warmup Inference ──────────────────────────────────────────────────────
# Triggers CUDA kernel compilation so the first real request isn't slow.

print("[Starting up] Running warmup inference...")
try:
    for _ in MODEL.inference_zero_shot(
        "warmup",
        "You are a helpful assistant.<|endofprompt|>warmup",
        "/app/CosyVoice/asset/zero_shot_prompt.wav",
        stream=False,
    ):
        pass
    print("[Starting up] Warmup complete.")
except Exception as e:
    print(f"[Warning] Warmup failed (is the asset path correct?): {e}")


# ── Routes ────────────────────────────────────────────────────────────────

@app.get("/health")
def health_check():
    return {"status": "ok", "model": "Fun-CosyVoice3-0.5B"}


@app.post("/synthesize")
async def synthesize(
    text: str = Form(...),
    mode: str = Form(...),
    speed: float = Form(1.0),
    reference_text: str = Form(""),
    reference_audio: UploadFile = File(...)
):
    # Validate inputs
    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    if mode not in ("cross_lingual", "zero_shot"):
        raise HTTPException(status_code=400, detail="Invalid mode (cross_lingual, zero_shot)")

    if mode == "zero_shot" and not reference_text:
        raise HTTPException(status_code=400, detail="reference_text is required for zero_shot")

    speed = max(0.5, min(2.0, speed))

    # Save uploaded file to temp path
    fd, temp_wav_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    
    try:
        # Write bytes
        with open(temp_wav_path, "wb") as f:
            f.write(await reference_audio.read())

        # Validate it's a valid audio file (avoids CosyVoice crashing)
        try:
            waveform, sample_rate = torchaudio.load(temp_wav_path)
            duration = waveform.shape[1] / sample_rate
            if duration < 1.0:
                raise HTTPException(status_code=400, detail="Reference audio too short (< 1s)")
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(status_code=400, detail="Invalid audio file")

        # Inference
        print(f"Synthesizing | Mode: {mode} | Text len: {len(text)} | Ref duration: {duration:.2f}s")
        
        try:
            if mode == "cross_lingual":
                output_gen = MODEL.inference_cross_lingual(
                    f"You are a helpful assistant.<|endofprompt|>{text}",
                    temp_wav_path,
                    stream=False,
                    speed=speed,
                )
            else:
                output_gen = MODEL.inference_zero_shot(
                    text,
                    reference_text,
                    temp_wav_path,
                    stream=False,
                    speed=speed,
                )
            
            # Generator yields dicts with 'tts_speech'
            all_chunks = []
            for chunk in output_gen:
                all_chunks.append(chunk["tts_speech"])
                
            if not all_chunks:
                raise HTTPException(status_code=500, detail="Model returned no audio")

            # Concatenate chunks
            speech_tensor = torch.cat(all_chunks, dim=1)
            
            # Save raw tensor to WAV format in memory
            wav_io = io.BytesIO()
            torchaudio.save(
                wav_io,
                speech_tensor,
                MODEL.sample_rate,
                format="wav"
            )
            wav_io.seek(0)
            
            # Return binary stream
            return StreamingResponse(wav_io, media_type="audio/wav")

        except Exception as e:
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=str(e))
            
    finally:
        # Clean up temp file
        if os.path.exists(temp_wav_path):
            os.remove(temp_wav_path)

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={"error": str(exc)}
    )
