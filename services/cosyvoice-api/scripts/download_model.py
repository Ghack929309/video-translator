import os
from huggingface_hub import snapshot_download

# Explicitly download ModelScope dependencies used by WeTextProcessing natively
from modelscope import snapshot_download as ms_download

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Use /app permanently to avoid RunPod's /workspace Persistent Volume mask wiping our files!
DEFAULT_MODEL_DIR = "/app/pretrained_models/Fun-CosyVoice3-0.5B" if os.path.exists("/app") else os.path.join(BASE_DIR, "pretrained_models", "Fun-CosyVoice3-0.5B")

MODEL_DIR = os.environ.get("MODEL_DIR", DEFAULT_MODEL_DIR)
snapshot_download(repo_id="FunAudioLLM/Fun-CosyVoice3-0.5B", local_dir=MODEL_DIR, local_dir_use_symlinks=False)
print(f"Model physically baked to {MODEL_DIR}")

# Pre-download Chinese text normalization FST models to eliminate runtime ModelScope fetches
ms_download("pengzhendong/wetext")
print("WeText normalization FST models physically baked to cache.")

# Pre-download Demucs htdemucs model for audio source separation
print("Pre-downloading Demucs htdemucs model...")
from demucs.api import Separator
_sep = Separator(model="htdemucs")
del _sep
print("Demucs htdemucs model baked to cache.")
