import os
import sys
import tempfile
import traceback
import io
import base64
import subprocess
import shutil

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

# ── Readiness Gate ─────────────────────────────────────────────────────────
READY = False

# ── Demucs via CLI subprocess ─────────────────────────────────────────────

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

READY = True
print("[Starting up] Server is READY to accept requests.")

# ── Routes ────────────────────────────────────────────────────────────────

@app.get("/health")
def health_check():
    return {
        "ready": READY,
        "status": "ok" if READY else "loading",
        "model": "Fun-CosyVoice3-0.5B",
    }


@app.post("/separate")
async def separate_audio(audio: UploadFile = File(...)):
    """Separate audio into vocals and background using Demucs htdemucs CLI (per D-01, D-02)."""
    work_dir = tempfile.mkdtemp(prefix="demucs_")
    input_path = os.path.join(work_dir, "input.wav")
    out_dir = os.path.join(work_dir, "out")

    try:
        with open(input_path, "wb") as f:
            f.write(await audio.read())

        # Run demucs CLI: --two-stems=vocals splits into vocals + no_vocals (background)
        result = subprocess.run(
            ["python", "-m", "demucs", "-n", "htdemucs", "--two-stems=vocals",
             "-o", out_dir, input_path],
            capture_output=True, text=True, timeout=300,
        )
        if result.returncode != 0:
            raise RuntimeError(f"Demucs CLI failed: {result.stderr}")

        # demucs outputs to: out_dir/htdemucs/input/vocals.wav and no_vocals.wav
        stem_dir = os.path.join(out_dir, "htdemucs", "input")
        vocals_path = os.path.join(stem_dir, "vocals.wav")
        bg_path = os.path.join(stem_dir, "no_vocals.wav")

        if not os.path.exists(vocals_path) or not os.path.exists(bg_path):
            raise RuntimeError(f"Demucs output missing. Dir contents: {os.listdir(stem_dir) if os.path.exists(stem_dir) else 'stem_dir not found'}")

        # Read output files and get sample rate
        bg_wav, bg_sr = torchaudio.load(bg_path)
        vocals_wav, _ = torchaudio.load(vocals_path)

        # Encode to base64
        bg_io = io.BytesIO()
        torchaudio.save(bg_io, bg_wav, bg_sr, format="wav")
        bg_bytes = bg_io.getvalue()

        vocals_io = io.BytesIO()
        torchaudio.save(vocals_io, vocals_wav, bg_sr, format="wav")
        vocals_bytes = vocals_io.getvalue()

        return JSONResponse({
            "background": base64.b64encode(bg_bytes).decode("ascii"),
            "vocals": base64.b64encode(vocals_bytes).decode("ascii"),
            "sample_rate": bg_sr,
        })
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Demucs separation failed: {str(e)}")
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


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
