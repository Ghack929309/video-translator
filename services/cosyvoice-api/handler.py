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
    from huggingface_hub import snapshot_download

    model_path = snapshot_download(
        repo_id="FunAudioLLM/CosyVoice3-0.5B",
        local_dir=MODEL_DIR,
    )
    model = AutoModel(model_dir=model_path)
elif MODEL_SOURCE == "volume":
    volume_path = os.environ.get(
        "VOLUME_MODEL_PATH", "/runpod-volume/models/Fun-CosyVoice3-0.5B"
    )
    model = AutoModel(model_dir=volume_path)
else:
    raise ValueError(f"Unknown MODEL_SOURCE: {MODEL_SOURCE}")

print(
    f"[cosyvoice-api] Model loaded (source: {MODEL_SOURCE}, sample_rate: {model.sample_rate})"
)


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

        # ── Validate ────────────────────────────────────────────
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

        # ── Decode prompt WAV ───────────────────────────────────
        prompt_wav_bytes = base64.b64decode(prompt_wav_b64)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(prompt_wav_bytes)
            prompt_wav_path = f.name

        try:
            # ── Inference ───────────────────────────────────────
            if mode == "cross_lingual":
                # CosyVoice3: prefix prepended to tts_text
                prefixed_text = f"{SYSTEM_PREFIX}{tts_text}"
                output_gen = model.inference_cross_lingual(
                    prefixed_text,
                    prompt_wav_path,
                    stream=False,
                    speed=speed,
                )
            else:
                # CosyVoice3: prefix prepended to prompt_text
                prompt_text = job_input.get("prompt_text", "")
                prefixed_prompt = f"{SYSTEM_PREFIX}{prompt_text}"
                output_gen = model.inference_zero_shot(
                    tts_text,
                    prefixed_prompt,
                    prompt_wav_path,
                    stream=False,
                    speed=speed,
                )

            # ── Collect chunks ──────────────────────────────────
            all_speech = []
            for chunk in output_gen:
                all_speech.append(chunk["tts_speech"])

            if not all_speech:
                return {"error": "Model returned no audio"}

            # ── Convert to WAV ──────────────────────────────────
            import io
            speech_tensor = torch.cat(all_speech, dim=1)  # [1, samples]
            
            wav_io = io.BytesIO()
            torchaudio.save(
                wav_io,
                speech_tensor.cpu(),
                SAMPLE_RATE,
                format="wav"
            )
            wav_bytes = wav_io.getvalue()

            # ── Encode + return ─────────────────────────────────
            audio_b64 = base64.b64encode(wav_bytes).decode("ascii")
            duration_sec = speech_tensor.shape[1] / SAMPLE_RATE

            print(
                f"[cosyvoice-api] Synthesized {duration_sec:.2f}s "
                f"({len(wav_bytes)} bytes WAV, mode: {mode})"
            )

            return {
                "audio": audio_b64,
                "sample_rate": SAMPLE_RATE,
                "duration_sec": round(duration_sec, 3),
            }

        finally:
            os.unlink(prompt_wav_path)

    except Exception as e:
        error_trace = traceback.format_exc()
        print(f"[cosyvoice-api] Error: {e}\n{error_trace}")
        return {"error": str(e), "traceback": error_trace}


# ── Start RunPod Worker ─────────────────────────────────────────

runpod.serverless.start({"handler": handler})
