import os
from huggingface_hub import snapshot_download

MODEL_DIR = os.environ.get("MODEL_DIR", "/workspace/pretrained_models/Fun-CosyVoice3-0.5B")
snapshot_download(repo_id="FunAudioLLM/CosyVoice3-0.5B", local_dir=MODEL_DIR)
print(f"Model downloaded to {MODEL_DIR}")
