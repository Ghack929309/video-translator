FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

WORKDIR /app

# System deps for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    sox \
    libsndfile1 \
    git \
    && rm -rf /var/lib/apt/lists/*

# Clone CosyVoice repo (model code + Matcha-TTS third_party)
RUN git clone --depth 1 https://github.com/FunAudioLLM/CosyVoice.git /app/cosyvoice-repo

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install CosyVoice repo's own deps
RUN cd /app/cosyvoice-repo && pip install --no-cache-dir -r requirements.txt || true

# Set up CosyVoice code paths via symlinks
RUN ln -sf /app/cosyvoice-repo/cosyvoice /app/cosyvoice && \
    ln -sf /app/cosyvoice-repo/third_party /app/third_party

# Copy handler
COPY handler.py .

# RunPod volume mount point
RUN mkdir -p /runpod-volume

ENV PYTHONPATH=/app:/app/cosyvoice-repo
ENV MODEL_SOURCE=volume
ENV VOLUME_MODEL_PATH=/runpod-volume/models/Fun-CosyVoice3-0.5B

CMD ["python", "-u", "handler.py"]
