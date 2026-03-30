FROM --platform=linux/amd64 nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04

WORKDIR /app

# 1. System dependencies
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    git git-lfs build-essential ffmpeg sox libsox-dev wget curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Miniforge
RUN curl -L -O "https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-$(uname)-$(uname -m).sh" \
    && bash Miniforge3-$(uname)-$(uname -m).sh -b -p /opt/conda \
    && rm Miniforge3-$(uname)-$(uname -m).sh
ENV PATH="/opt/conda/bin:$PATH"

# 3. Create CosyVoice conda environment (pynini requires conda-forge)
RUN conda create -n cosyvoice python=3.10 pynini=2.1.5 -c conda-forge -y
ENV PATH="/opt/conda/envs/cosyvoice/bin:$PATH"

# 4. Clone CosyVoice repository
RUN git clone --recursive https://github.com/FunAudioLLM/CosyVoice.git

# 5. CosyVoice Python dependencies (order matters for caching)
RUN pip install --no-cache-dir "setuptools<70" wheel && \
    pip install --no-cache-dir --no-build-isolation openai-whisper==20231117
RUN pip install --no-cache-dir -r CosyVoice/requirements.txt

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 6. Isolated Demucs environment with its own CUDA-enabled PyTorch
# This avoids conflicts with CosyVoice's PyTorch version while enabling GPU acceleration
RUN conda create -n demucs python=3.10 -y && \
    /opt/conda/envs/demucs/bin/pip install --no-cache-dir \
        torch torchaudio --index-url https://download.pytorch.org/whl/cu124 && \
    /opt/conda/envs/demucs/bin/pip install --no-cache-dir demucs==4.0.1

# Pre-download Demucs htdemucs model weights into a shared cache dir.
# Docker build has no GPU, so we use a Python script to trigger torch.hub download
# without running inference. The model weights will be at /app/.cache/torch/hub/
ENV TORCH_HOME="/app/.cache/torch"
RUN /opt/conda/envs/demucs/bin/python -c "\
import torch; \
from demucs.pretrained import get_model; \
model = get_model('htdemucs'); \
print(f'[demucs] htdemucs model downloaded ({sum(p.numel() for p in model.parameters())} params)') \
"

# 7. Bake CosyVoice model weights into the image
ENV MODELSCOPE_CACHE="/app/.cache/modelscope"
COPY scripts/download_model.py scripts/
RUN python scripts/download_model.py

# 8. Setup runtime
COPY server.py .
COPY handler.py .
ENV PYTHONPATH="/app/CosyVoice:/app/CosyVoice/third_party/Matcha-TTS"

EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
