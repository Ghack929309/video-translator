import os
import sys
import re
import tempfile
import traceback
import io
import subprocess
import shutil
import uuid
import threading

import logging
logging.getLogger("multipart").setLevel(logging.WARNING)

from fastapi import FastAPI, UploadFile, Form, File, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse

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
# task_id -> { status, output_dir (on disk), error }
# Output files are served via /separate/{task_id}/{stem} endpoints.
TASKS: dict[str, dict] = {}
TASKS_LOCK = threading.Lock()

# Persistent output dir for demucs results (cleaned up after download)
DEMUCS_OUTPUT_BASE = os.path.join(tempfile.gettempdir(), "demucs_tasks")
os.makedirs(DEMUCS_OUTPUT_BASE, exist_ok=True)

# Demucs runs in its own conda env with CUDA-enabled PyTorch (isolated from CosyVoice)
DEMUCS_PYTHON = "/opt/conda/envs/demucs/bin/python"
if not os.path.exists(DEMUCS_PYTHON):
    # Fallback for local dev — use current env's python
    DEMUCS_PYTHON = sys.executable
    print(f"[demucs] Isolated env not found, using {DEMUCS_PYTHON}")


def _run_demucs_task(task_id: str, input_path: str, work_dir: str):
    """Run demucs in a background thread and store the result.
    Tries GPU first (fast, ~30s), falls back to CPU if CUDA fails."""
    output_dir = os.path.join(DEMUCS_OUTPUT_BASE, task_id)
    os.makedirs(output_dir, exist_ok=True)
    demucs_out = os.path.join(work_dir, "out")

    try:
        # Run demucs on GPU using isolated conda env with CUDA-enabled PyTorch.
        # TORCH_HOME ensures the subprocess finds the pre-downloaded model weights.
        demucs_env = {**os.environ, "TORCH_HOME": "/app/.cache/torch"}

        print(f"[demucs] Task {task_id}: running on GPU via isolated env ({DEMUCS_PYTHON})...")
        result = subprocess.run(
            [DEMUCS_PYTHON, "-m", "demucs", "-n", "htdemucs", "--two-stems=vocals",
             "-d", "cuda", "-o", demucs_out, input_path],
            capture_output=True, text=True, timeout=300,
            env=demucs_env,
        )

        if result.returncode != 0:
            gpu_err = result.stderr[-500:] if result.stderr else "unknown error"
            print(f"[demucs] Task {task_id}: GPU failed, trying CPU fallback...\n{gpu_err}")

            # Clean partial output and retry on CPU as last resort
            if os.path.exists(demucs_out):
                shutil.rmtree(demucs_out)

            result = subprocess.run(
                [DEMUCS_PYTHON, "-m", "demucs", "-n", "htdemucs", "--two-stems=vocals",
                 "-d", "cpu", "--segment", "30", "-o", demucs_out, input_path],
                capture_output=True, text=True, timeout=900,
                env=demucs_env,
            )

        if result.returncode != 0:
            raise RuntimeError(f"Demucs failed: {result.stderr[-500:]}")

        stem_dir = os.path.join(demucs_out, "htdemucs", "input")
        vocals_path = os.path.join(stem_dir, "vocals.wav")
        bg_path = os.path.join(stem_dir, "no_vocals.wav")

        if not os.path.exists(vocals_path) or not os.path.exists(bg_path):
            contents = os.listdir(stem_dir) if os.path.exists(stem_dir) else "stem_dir not found"
            raise RuntimeError(f"Demucs output missing. Dir contents: {contents}")

        # Move output files to persistent output dir (survives work_dir cleanup)
        shutil.move(bg_path, os.path.join(output_dir, "background.wav"))
        shutil.move(vocals_path, os.path.join(output_dir, "vocals.wav"))

        with TASKS_LOCK:
            TASKS[task_id] = {"status": "completed", "output_dir": output_dir}
        print(f"[demucs] Task {task_id} completed successfully.")

    except Exception as e:
        traceback.print_exc()
        with TASKS_LOCK:
            TASKS[task_id] = {"status": "failed", "error": str(e)}
        shutil.rmtree(output_dir, ignore_errors=True)
        print(f"[demucs] Task {task_id} failed: {e}")

    finally:
        # Clean up the working directory (demucs intermediate files)
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

def strip_control_tags(text: str) -> str:
    """Remove all <|...|> control tokens from text so they are never read aloud."""
    return re.sub(r"<\|[^|]*\|>", "", text).strip()

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

    thread = threading.Thread(target=_run_demucs_task, args=(task_id, input_path, work_dir), daemon=True)
    thread.start()

    print(f"[demucs] Started task {task_id}")
    return JSONResponse({"task_id": task_id, "status": "processing"})


@app.get("/separate/{task_id}")
def get_separate_status(task_id: str):
    """Poll for Demucs separation status (lightweight — no audio data)."""
    with TASKS_LOCK:
        task = TASKS.get(task_id)

    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    if task["status"] == "processing":
        return JSONResponse({"task_id": task_id, "status": "processing"})

    if task["status"] == "failed":
        with TASKS_LOCK:
            TASKS.pop(task_id, None)
        raise HTTPException(status_code=500, detail=f"Demucs separation failed: {task['error']}")

    # completed — just return status, files are downloaded separately
    return JSONResponse({"task_id": task_id, "status": "completed"})


@app.get("/separate/{task_id}/{stem}")
def download_stem(task_id: str, stem: str):
    """Download a separated audio stem (background or vocals)."""
    if stem not in ("background", "vocals"):
        raise HTTPException(status_code=400, detail="stem must be 'background' or 'vocals'")

    with TASKS_LOCK:
        task = TASKS.get(task_id)

    if task is None or task.get("status") != "completed":
        raise HTTPException(status_code=404, detail="Task not found or not completed")

    file_path = os.path.join(task["output_dir"], f"{stem}.wav")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"{stem}.wav not found")

    return FileResponse(file_path, media_type="audio/wav", filename=f"{stem}.wav")


@app.delete("/separate/{task_id}")
def cleanup_task(task_id: str):
    """Clean up task output files after client has downloaded them."""
    with TASKS_LOCK:
        task = TASKS.pop(task_id, None)

    if task and task.get("output_dir"):
        shutil.rmtree(task["output_dir"], ignore_errors=True)

    return JSONResponse({"status": "cleaned"})


@app.post("/synthesize")
async def synthesize(
    text: str = Form(...),
    mode: str = Form(...),
    speed: float = Form(1.0),
    target_language: str = Form(""),
    reference_text: str = Form(""),
    reference_audio: UploadFile = File(...)
):
    text = strip_control_tags(text.strip())
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    if mode not in ("cross_lingual", "zero_shot"):
        raise HTTPException(status_code=400, detail="Invalid mode (cross_lingual, zero_shot)")

    if mode == "zero_shot" and not reference_text:
        raise HTTPException(status_code=400, detail="reference_text is required for zero_shot")

    speed = max(0.5, min(2.0, speed))

    fd, temp_wav_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)

    try:
        with open(temp_wav_path, "wb") as f:
            f.write(await reference_audio.read())

        try:
            waveform, sample_rate = torchaudio.load(temp_wav_path)
            duration = waveform.shape[1] / sample_rate
            if duration < 1.0:
                raise HTTPException(status_code=400, detail="Reference audio too short (< 1s)")
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(status_code=400, detail="Invalid audio file")

        # Build the model prompt. CosyVoice 3 cross_lingual format:
        #   <|endofprompt|><|LANG|>text
        # The language tag MUST come right after endofprompt to set target phonology.
        # No English instruction prefix — it causes accent bleeding.
        lang_tag = f"<|{target_language}|>" if target_language else ""

        print(f"Synthesizing | Mode: {mode} | Lang: {target_language or 'auto'} | Text len: {len(text)} | Ref duration: {duration:.2f}s")

        try:
            if mode == "cross_lingual":
                output_gen = MODEL.inference_cross_lingual(
                    f"<|endofprompt|>{lang_tag}{text}",
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

            all_chunks = []
            for chunk in output_gen:
                all_chunks.append(chunk["tts_speech"])

            if not all_chunks:
                raise HTTPException(status_code=500, detail="Model returned no audio")

            speech_tensor = torch.cat(all_chunks, dim=1)

            wav_io = io.BytesIO()
            torchaudio.save(wav_io, speech_tensor, MODEL.sample_rate, format="wav")
            wav_io.seek(0)

            return StreamingResponse(wav_io, media_type="audio/wav")

        except Exception as e:
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=str(e))

    finally:
        if os.path.exists(temp_wav_path):
            os.remove(temp_wav_path)

@app.post("/synthesize_instruct2")
async def synthesize_instruct2(
    text: str = Form(...),
    instruct_text: str = Form(...),
    speed: float = Form(1.0),
    target_language: str = Form(""),
    reference_audio: UploadFile = File(...)
):
    """Synthesize speech using CosyVoice 3 instruct2 mode.

    instruct_text controls voice style, emotion, and accent.
    Example: "Speak with a warm, enthusiastic French tone."

    This mode is ideal for:
    - Short segments where cross_lingual produces accent bleeding
    - Emotion-aware synthesis (happy, sad, angry, etc.)
    """
    text = strip_control_tags(text.strip())
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    instruct_text = strip_control_tags(instruct_text.strip())
    if not instruct_text:
        raise HTTPException(status_code=400, detail="instruct_text cannot be empty")

    speed = max(0.5, min(2.0, speed))

    fd, temp_wav_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)

    try:
        with open(temp_wav_path, "wb") as f:
            f.write(await reference_audio.read())

        try:
            waveform, sample_rate = torchaudio.load(temp_wav_path)
            duration = waveform.shape[1] / sample_rate
            if duration < 1.0:
                raise HTTPException(status_code=400, detail="Reference audio too short (< 1s)")
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(status_code=400, detail="Invalid audio file")

        # For instruct2, pass plain text only — the model handles prompt formatting internally.
        # Do NOT add <|endofprompt|> or language tags; the instruct_text already controls language/style.
        final_text = text

        print(f"Synthesizing (instruct2) | Lang: {target_language or 'auto'} | Text: {text[:60]}... | Instruct: {instruct_text[:60]}...")

        try:
            output_gen = MODEL.inference_instruct2(
                final_text,
                instruct_text,
                temp_wav_path,
                stream=False,
                speed=speed,
            )

            all_chunks = []
            for chunk in output_gen:
                all_chunks.append(chunk["tts_speech"])

            if not all_chunks:
                raise HTTPException(status_code=500, detail="Model returned no audio")

            speech_tensor = torch.cat(all_chunks, dim=1)

            wav_io = io.BytesIO()
            torchaudio.save(wav_io, speech_tensor, MODEL.sample_rate, format="wav")
            wav_io.seek(0)

            return StreamingResponse(wav_io, media_type="audio/wav")

        except AttributeError:
            # Model doesn't support inference_instruct2 — fall back to cross_lingual
            # cross_lingual needs <|endofprompt|> prefix
            print(f"[instruct2] Model lacks inference_instruct2 — falling back to cross_lingual")
            cross_lingual_text = f"<|endofprompt|>{final_text}"
            output_gen = MODEL.inference_cross_lingual(
                cross_lingual_text,
                temp_wav_path,
                stream=False,
                speed=speed,
            )

            all_chunks = []
            for chunk in output_gen:
                all_chunks.append(chunk["tts_speech"])

            if not all_chunks:
                raise HTTPException(status_code=500, detail="Model returned no audio")

            speech_tensor = torch.cat(all_chunks, dim=1)

            wav_io = io.BytesIO()
            torchaudio.save(wav_io, speech_tensor, MODEL.sample_rate, format="wav")
            wav_io.seek(0)

            return StreamingResponse(wav_io, media_type="audio/wav")

        except Exception as e:
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=str(e))

    finally:
        if os.path.exists(temp_wav_path):
            os.remove(temp_wav_path)


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={"error": str(exc)}
    )
