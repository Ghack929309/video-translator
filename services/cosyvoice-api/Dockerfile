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

# 3. Create conda environment (pynini requires conda-forge)
RUN conda create -n cosyvoice python=3.10 pynini=2.1.5 -c conda-forge -y
ENV PATH="/opt/conda/envs/cosyvoice/bin:$PATH"

# 4. Clone CosyVoice repository
RUN git clone --recursive https://github.com/FunAudioLLM/CosyVoice.git

# 5. Pipeline Python dependencies (order matters for caching)
# Pre-install openai-whisper with legacy setuptools to avoid pkg_resources build isolation errors
RUN pip install --no-cache-dir "setuptools<70" wheel && \
    pip install --no-cache-dir --no-build-isolation openai-whisper==20231117
RUN pip install --no-cache-dir -r CosyVoice/requirements.txt

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download Demucs htdemucs model weights via CLI to avoid first-run latency
# (demucs 4.0.1 doesn't have demucs.api, so we use the CLI which triggers model download)
RUN python -m demucs --help > /dev/null 2>&1 && \
    mkdir -p /tmp/demucs_warmup && \
    ffmpeg -f lavfi -i "sine=frequency=440:duration=3" -ar 44100 -ac 2 /tmp/demucs_warmup/test.wav && \
    python -m demucs -n htdemucs --two-stems=vocals -o /tmp/demucs_warmup/out /tmp/demucs_warmup/test.wav && \
    rm -rf /tmp/demucs_warmup

# 6. Bake model weights into the image to eliminate cold start latency
ENV MODELSCOPE_CACHE="/app/.cache/modelscope"
COPY scripts/download_model.py scripts/
RUN python scripts/download_model.py

# 7. Setup runtime
COPY server.py .
COPY handler.py .
ENV PYTHONPATH="/app/CosyVoice:/app/CosyVoice/third_party/Matcha-TTS"

EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
