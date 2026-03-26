# Phase 4: Implement the CosyVoice 3 API Service - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the self-hosted CosyVoice 3 inference API as a Python service inside this repo. The service uses RunPod's Serverless Handler pattern (`runpod.serverless.start()`) to load the `Fun-CosyVoice3-0.5B-2512` model and expose a handler that processes TTS inference requests. This is the GPU-backed API that `cosyvoice.server.ts` (Phase 1) calls.

</domain>

<decisions>
## Implementation Decisions

### Codebase Location
- **D-01:** New directory in the project root: `services/cosyvoice-api/`. Contains its own `Dockerfile`, `requirements.txt`, `handler.py`, and `README.md`. Completely independent from the Node.js app — separate Python runtime, separate deployment.

### RunPod Integration Pattern
- **D-02:** Use RunPod Serverless Handler pattern (`runpod.serverless.start({"handler": handler_fn})`). Model loads globally on cold start, handler processes individual requests. RunPod manages scaling, queueing, and GPU allocation. No FastAPI server needed — RunPod's serverless infra handles HTTP routing.

### Model Loading Strategy
- **D-03 (Local/Dev):** Download model weights from HuggingFace on first run. Use `snapshot_download()` with cache to `~/.cache/huggingface/`. Slower first start (~30-60s) but zero manual setup.
- **D-04 (Production):** Mount model weights from RunPod network volume. Volume pre-loaded with model files. Near-instant model load on cold start. Volume path: `/runpod-volume/models/CosyVoice3-0.5B/`.
- **D-05:** Dockerfile supports both modes via environment variable `MODEL_SOURCE` (`huggingface` | `volume`). Default: `huggingface` for dev, `volume` for prod.

### API Contract (Must Match Phase 1 Client)
- **D-06:** Handler accepts multipart/form-data with fields: `tts_text`, `mode` ("cross_lingual" | "zero_shot"), `stream` ("false"), `speed` (float), `prompt_wav` (file), `prompt_text` (string, zero_shot only).
- **D-07:** Handler returns raw PCM int16 bytes (24kHz, mono) — `cosyvoice.server.ts` handles WAV header wrapping.
- **D-08:** RunPod Serverless Handler receives requests as JSON with base64-encoded audio. The handler decodes, runs inference, and returns base64-encoded PCM. Note: this differs from a raw FastAPI multipart endpoint — RunPod's handler pattern uses JSON I/O.

### Agent's Discretion
- Exact Python package versions in requirements.txt
- CosyVoice model initialization code (from official repo examples)
- Error handling and logging patterns
- Health check / test script structure
- `.dockerignore` contents

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1 Client (Must Match)
- `app/services/cosyvoice.server.ts` — The HTTP client that calls this API. Handler I/O must match what the client sends/expects.

### CosyVoice API Contract
- `.planning/PROJECT.md` §Context → CosyVoice 3 API Contract — endpoint spec, fields, response format

### CosyVoice Model
- Model: `Fun-CosyVoice3-0.5B-2512` from HuggingFace (`FunAudioLLM/CosyVoice3-0.5B`)
- Apache 2.0 license, 0.5B parameters
- Requires NVIDIA GPU with 8GB+ VRAM

### RunPod Serverless Docs
- RunPod Serverless Handler pattern: `runpod.serverless.start()`
- Docker image must include CUDA runtime + Python 3.10+

</canonical_refs>

<code_context>
## Existing Code Insights

### New Files (to create)
- `services/cosyvoice-api/handler.py` — RunPod handler with model loading + inference
- `services/cosyvoice-api/Dockerfile` — CUDA base image + Python deps + model code
- `services/cosyvoice-api/requirements.txt` — PyTorch, CosyVoice deps, runpod SDK
- `services/cosyvoice-api/README.md` — Setup, local testing, deployment instructions
- `services/cosyvoice-api/test_handler.py` — Local test script

### Integration Points
- `cosyvoice.server.ts` line ~147: `fetch(\`\${env.COSYVOICE_URL}/inference\`, ...)` — the client endpoint
- RunPod Serverless exposes the handler at `https://{endpoint-id}-{pod-id}.proxy.runpod.net/runsync` or `/run`

</code_context>

<specifics>
## Specific Ideas

- RunPod Serverless Handler receives `{"input": {...}}` JSON, returns `{"output": "base64_pcm_data"}` or `{"error": "message"}`
- May need to adapt `cosyvoice.server.ts` to match RunPod's JSON API pattern instead of raw multipart (Phase 1 assumed raw FastAPI — RunPod wraps differently)
- CosyVoice 3 official repo has example inference code for `cross_lingual` and `zero_shot` modes
- Docker base: `runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04` or similar

</specifics>

<deferred>
## Deferred Ideas

- Warm worker pool on RunPod (PERF-01) — keep at cold start for now
- Batch inference for multiple segments (PERF-02) — single segment per call for now

</deferred>

---

*Phase: 04-implement-the-cosyvoice-3-api-service*
*Context gathered: 2026-03-26*
