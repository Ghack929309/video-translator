import os
import sys
import tempfile
import traceback
import io
import base64
import subprocess
import shutil
import uuid
import threading

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

# ── Async Demucs Task Store ───────────────────────────────────────────────
# Tasks are stored in memory — fine since there's only one pod and tasks
# are short-lived (cleaned up after retrieval or 30 minutes).
TASKS: dict[str, dict] = {}
TASKS_LOCK = threading.Lock()


def _run_demucs_task(task_id: str, input_path: str, work_dir: str):
    """Run demucs in a background thread and store the result."""
    out_dir = os.path.join(work_dir, "out")
    try:
        result = subprocess.run(
            ["python", "-m", "demucs", "-n", "htdemucs", "--two-stems=vocals",
             "-d", "cpu", "-o", out_dir, input_path],
            capture_output=True, text=True, timeout=600,
        )
        if result.returncode != 0:
            raise RuntimeError(f"Demucs CLI failed: {result.stderr[-500:]}")

        stem_dir = os.path.join(out_dir, "htdemucs", "input")
        vocals_path = os.path.join(stem_dir, "vocals.wav")
        bg_path = os.path.join(stem_dir, "no_vocals.wav")

        if not os.path.exists(vocals_path) or not os.path.exists(bg_path):
            contents = os.listdir(stem_dir) if os.path.exists(stem_dir) else "stem_dir not found"
            raise RuntimeError(f"Demucs output missing. Dir contents: {contents}")

        bg_wav, bg_sr = torchaudio.load(bg_path)
        vocals_wav, _ = torchaudio.load(vocals_path)

        bg_io = io.BytesIO()
        torchaudio.save(bg_io, bg_wav, bg_sr, format="wav")

        vocals_io = io.BytesIO()
        torchaudio.save(vocals_io, vocals_wav, bg_sr, format="wav")

        with TASKS_LOCK:
            TASKS[task_id] = {
                "status": "completed",
                "background": base64.b64encode(bg_io.getvalue()).decode("ascii"),
                "vocals": base64.b64encode(vocals_io.getvalue()).decode("ascii"),
                "sample_rate": bg_sr,
            }
        print(f"[demucs] Task {task_id} completed successfully.")

    except Exception as e:
        traceback.print_exc()
        with TASKS_LOCK:
            TASKS[task_id] = {"status": "failed", "error": str(e)}
        print(f"[demucs] Task {task_id} failed: {e}")

    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


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
    """Start async Demucs separation. Returns a task_id to poll."""
    task_id = str(uuid.uuid4())
    work_dir = tempfile.mkdtemp(prefix="demucs_")
    input_path = os.path.join(work_dir, "input.wav")

    with open(input_path, "wb") as f:
        f.write(await audio.read())

    with TASKS_LOCK:
        TASKS[task_id] = {"status": "processing"}

    # Run demucs in background thread — returns immediately to avoid proxy timeout
    thread = threading.Thread(target=_run_demucs_task, args=(task_id, input_path, work_dir), daemon=True)
    thread.start()

    print(f"[demucs] Started task {task_id}")
    return JSONResponse({"task_id": task_id, "status": "processing"})


@app.get("/separate/{task_id}")
def get_separate_result(task_id: str):
    """Poll for Demucs separation result."""
    with TASKS_LOCK:
        task = TASKS.get(task_id)

    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    if task["status"] == "processing":
        return JSONResponse({"task_id": task_id, "status": "processing"})

    if task["status"] == "failed":
        # Clean up task after retrieval
        with TASKS_LOCK:
            TASKS.pop(task_id, None)
        raise HTTPException(status_code=500, detail=f"Demucs separation failed: {task['error']}")

    # completed — return result and clean up
    result = {
        "task_id": task_id,
        "status": "completed",
        "background": task["background"],
        "vocals": task["vocals"],
        "sample_rate": task["sample_rate"],
    }
    with TASKS_LOCK:
        TASKS.pop(task_id, None)
    return JSONResponse(result)


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
