import os
from huggingface_hub import snapshot_download

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_MODEL_DIR = "/workspace/pretrained_models/Fun-CosyVoice3-0.5B" if os.path.exists("/workspace") else os.path.join(BASE_DIR, "pretrained_models", "Fun-CosyVoice3-0.5B")

MODEL_DIR = os.environ.get("MODEL_DIR", DEFAULT_MODEL_DIR)
snapshot_download(repo_id="FunAudioLLM/CosyVoice3-0.5B", local_dir=MODEL_DIR)
print(f"Model downloaded to {MODEL_DIR}")
