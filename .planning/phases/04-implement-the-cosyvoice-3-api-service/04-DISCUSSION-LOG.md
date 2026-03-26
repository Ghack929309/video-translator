# Phase 4: Implement the CosyVoice 3 API Service - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-26
**Phase:** 4-Implement the CosyVoice 3 API Service
**Areas discussed:** Codebase Location, RunPod Integration Pattern, Model Loading Strategy

---

## Codebase Location

| Option | Description | Selected |
|--------|-------------|----------|
| Subfolder in project root | `services/cosyvoice-api/` within this repo | ✓ |
| Separate repo | Independent repository for the Python service | |

**User's choice:** Subfolder in project root
**Notes:** Keeps everything in one place for easier development. Independent Dockerfile + requirements.txt.

---

## RunPod Integration Pattern

| Option | Description | Selected |
|--------|-------------|----------|
| RunPod Serverless Handler | `runpod.serverless.start()` — model loads on cold start, handler processes requests | ✓ |
| FastAPI server | Standard FastAPI inside RunPod Docker template — more control, custom health checks | |

**User's choice:** RunPod Serverless Handler (option A)
**Notes:** Simpler for async GPU workloads. RunPod manages scaling and queueing.

---

## Model Loading Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| HuggingFace download (local) | Download on first start, cached locally | ✓ (dev) |
| Network volume (prod) | Pre-loaded volume mounted at runtime | ✓ (prod) |
| Bake into Docker image | ~1GB+ image, instant cold start | |

**User's choice:** HuggingFace for local/dev, network volume for prod
**Notes:** Dual-mode via `MODEL_SOURCE` env var. HuggingFace for zero-setup dev, volume for fast prod cold starts.

---

## Deferred Ideas

- Warm worker pool (PERF-01)
- Batch inference (PERF-02)
