FROM --platform=linux/amd64 nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04

WORKDIR /workspace

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

# 3. Create conda environment (pynini requires conda-forge)
RUN conda create -n cosyvoice python=3.10 pynini=2.1.5 -c conda-forge -y
ENV PATH="/opt/conda/envs/cosyvoice/bin:$PATH"

# 4. Clone CosyVoice repository
RUN git clone --recursive https://github.com/FunAudioLLM/CosyVoice.git

# 5. Pipeline Python dependencies (order matters for caching)
RUN pip install --no-cache-dir -r CosyVoice/requirements.txt

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 6. Bake model weights into the image to eliminate cold start latency
COPY scripts/download_model.py scripts/
RUN python scripts/download_model.py

# 7. Setup runtime
COPY server.py .
COPY handler.py .
ENV PYTHONPATH="/workspace/CosyVoice:/workspace/CosyVoice/third_party/Matcha-TTS"

EXPOSE 50000
CMD ["python", "-u", "handler.py"]
