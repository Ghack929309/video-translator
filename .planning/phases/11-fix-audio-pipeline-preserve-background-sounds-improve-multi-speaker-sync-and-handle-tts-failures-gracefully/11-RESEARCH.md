# Phase 11: Fix Audio Pipeline -- Research

**Researched:** 2026-03-29
**Domain:** Audio source separation, TTS retry/resilience, audio pacing, FFmpeg mixing/ducking
**Confidence:** HIGH

## Summary

This phase overhauls the audio pipeline across three domains: (1) background audio preservation via Demucs AI source separation running on the same GPU pod as CosyVoice, (2) robust TTS failure handling with per-segment retries, pod restart detection, and graceful degradation, and (3) improved audio pacing by synthesizing at natural speed and using gap-aware stretching. The merge step changes from a simple audio replacement to a two-pass approach: first pre-mix synthesized speech with ducked background, then mux onto video.

All code changes target existing files (pipeline.server.ts, ffmpeg.server.ts, cosyvoice.server.ts, server.py, Dockerfile, schema.prisma) plus minor UI additions (ducking toggle on new-translation form, failed segment warnings on translation detail page). The Demucs Python library (v4.0.1, `pip install demucs`) runs on GPU alongside CosyVoice with approximately 3-7GB VRAM depending on segment size -- well within the RTX 4090/A100 capacity already provisioned.

**Primary recommendation:** Implement changes in this order: (1) Prisma schema migration, (2) CosyVoice FastAPI server updates (health + separate endpoints + Dockerfile), (3) pipeline step additions (SEPARATE_AUDIO, revised SYNTHESIZE, revised MERGE), (4) FFmpeg new methods (ducking, pre-mix, quality check), (5) UI changes (ducking toggle, failed segment warnings).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Use Demucs (Meta/Facebook) AI-based source separation with the `htdemucs` model variant to separate vocals from background audio. Higher quality than FFmpeg filter-based approaches.
- **D-02:** Demucs runs on the same RunPod pod as CosyVoice (GPU-accelerated). Add a separate `POST /separate` endpoint on the CosyVoice FastAPI server that accepts audio, runs Demucs, and returns separated vocals + background tracks.
- **D-03:** Extract background from the original video's audio stream (highest quality, pre-downsampling), not from the already-extracted 16kHz mono WAV.
- **D-04:** Add a new pipeline step `SEPARATE_AUDIO` between EXTRACT_AUDIO and TRANSCRIBE. Independent idempotency, cleaner separation of concerns.
- **D-05:** Re-separate background audio each time (no caching across translations of the same video). Simpler pipeline.
- **D-06:** Background audio ducking is a simple on/off toggle in the UI (default: on, -8dB during speech). Not a slider or multi-level control.
- **D-07:** If background extraction fails or produces garbage, fall back silently to speech-only (current behavior). Don't block the pipeline over background audio.
- **D-08:** Add a lightweight `GET /health` endpoint to the CosyVoice FastAPI server that returns `{"ready": true}` only after the model is fully loaded and warmup inference completes. Used by the pipeline and also serves the Demucs endpoint readiness.
- **D-09:** Before SYNTHESIZE step, perform a health check by polling the `/health` endpoint. Wait up to 3 minutes for the pod to be ready. This catches pod restarts (observed: model re-download + warmup takes ~10s).
- **D-10:** When TTS fails mid-process after previously succeeding (pod restart detected), pause the pipeline and wait for pod recovery by polling `/health`. Resume from the failed segment. These recovery waits don't count as segment-level retries.
- **D-11:** Per-segment retry strategy: 5 retries with exponential backoff (2s, 4s, 8s, 16s, 30s). Total wait ~60s per segment.
- **D-12:** When ALL retries fail for a segment, fall back to silence for that segment. Continue processing remaining segments.
- **D-13:** Track failed segments in the DB -- store a list of failed segment indices + error reasons on the Translation record. Surface in the UI: "Warning: X of Y segments could not be synthesized."
- **D-14:** If >50% of segments fail TTS, abort the entire job and mark as FAILED. A translation with mostly silence is not useful.
- **D-15:** Always synthesize at CosyVoice speed=1.0 (natural speed). Do NOT use the CosyVoice speed parameter for pacing. All pacing adjustments happen post-synthesis with FFmpeg.
- **D-16:** After synthesis, check if there's a silence gap between the current segment's end and the next segment's start. If there IS a gap, allow the synthesized speech to naturally overflow into it (no stretching needed). If there's NO gap, apply FFmpeg atempo stretch to fit within the segment boundary.
- **D-17:** Tighter stretch limits: 0.7x-1.5x (down from 0.4x-2.5x). More natural sound. If the target is outside this range, truncate with fade-out at the segment boundary.
- **D-18:** Layer overlapping segments from different speakers -- use the existing amix absolute position approach. Don't try to prevent overlap; let the audio mix naturally as it would in conversation.
- **D-19:** Remove the fixed `avgCharsPerSec = 14` constant and the `prosodySpeed` calculation. These are no longer needed since we're synthesizing at natural speed and handling pacing via gap detection + selective stretching.
- **D-20:** Pre-mix audio approach: first use FFmpeg amix to combine synthesized speech + ducked background into one audio track. Then replace the video's audio with this pre-mixed track. Two FFmpeg passes but cleaner control over ducking levels.
- **D-21:** Copy video codec (`-c:v copy`), encode only the new mixed audio to AAC. No quality loss on video, fast processing.
- **D-22:** Add a quality check after merge: verify output duration matches input (plus/minus 2s), audio stream exists and is >1KB, file size is reasonable. Catches silent/corrupt outputs before they reach users.
- **D-23:** Keep intermediate files (background track, pre-ducked mix) in `/tmp/dubly/{id}/` during processing for debugging. Clean up on success via existing `ffmpeg.cleanup()`.

### Claude's Discretion
- Exact Demucs API request/response format
- Ducking implementation details (sidechain compression vs simple volume reduction)
- How to detect "garbage" background extraction (heuristic for mostly-silence output)
- Exact quality check thresholds (file size bounds, duration tolerance)
- Pipeline step ordering for the new SEPARATE_AUDIO step (enum update, progress percentages)
- Schema changes needed for tracking failed segments and ducking preference

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| demucs | 4.0.1 | AI source separation (htdemucs model) | Meta Research standard; best-in-class vocal/music separation; GPU-accelerated |
| fluent-ffmpeg + ffmpeg-static | existing | Audio ducking, mixing, stretching, merge | Already in codebase; handles all FFmpeg operations |
| Prisma | existing | Schema migration for new fields | Already in codebase |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| torch / torchaudio | existing (in Docker) | Demucs dependency, already installed for CosyVoice | Required by Demucs, already present in the CUDA Docker image |

### Note on Demucs Installation
Demucs 4.0.1 is the latest PyPI release. The original Meta repo was archived January 2025; a maintenance fork exists at `github.com/adefossez/demucs`. The PyPI package `demucs` still works and `pip install demucs` is the standard installation. Since the CosyVoice Docker image already has PyTorch + CUDA + torchaudio, adding Demucs is just one `pip install` line.

**Demucs GPU requirements:** htdemucs needs approximately 3-7GB VRAM depending on the `segment` parameter. Default segment=12 uses ~7GB. The RunPod pods already have RTX 4090 (24GB) or A100 GPUs, so running both CosyVoice and Demucs sequentially (not concurrently) is well within capacity.

## Architecture Patterns

### Modified Pipeline Flow (8 Steps)
```
DOWNLOAD -> EXTRACT_AUDIO -> SEPARATE_AUDIO -> TRANSCRIBE -> TRANSLATE -> CLONE_VOICE -> SYNTHESIZE -> MERGE
                                  |
                           (new step: Demucs on GPU pod)
```

### SEPARATE_AUDIO Step Design
The new step sits between EXTRACT_AUDIO and TRANSCRIBE. It:
1. Extracts full-quality audio from the source video (NOT the 16kHz mono WAV used for transcription)
2. Sends it to the Demucs `/separate` endpoint on the GPU pod
3. Stores the background track in Tigris at `translations/{id}/background-audio.wav`
4. Stores the key as `backgroundAudioKey` on the Translation record
5. Is idempotent: skips if `backgroundAudioKey` already exists

**Critical insight from D-03:** The existing `extractAudio()` produces 16kHz mono WAV (optimized for AssemblyAI). For Demucs, we need a second extraction at full quality (44.1kHz stereo or whatever the source has). Add a new `extractAudioFullQuality()` method to ffmpeg.server.ts.

### Revised SYNTHESIZE Step Design
```
For each segment:
  1. Synthesize at speed=1.0 (no prosodySpeed manipulation)
  2. Measure actual generated duration
  3. Gap detection:
     - gapSec = nextSegStart - currentSegEnd (in seconds)
     - If gapSec > 0 AND generatedDuration <= segDuration + gapSec:
         -> Use as-is (natural overflow into gap)
     - If gapSec <= 0 OR generatedDuration > segDuration + gapSec:
         -> timeStretchExact to fit within segDuration (clamped 0.7x-1.5x)
         -> If outside 0.7-1.5x range: truncate with fade-out
  4. Track failed segments: on failure after all retries, record index + error
  5. If >50% segments fail: abort entire job
```

### Revised MERGE Step Design (Two-Pass)
```
Pass 1: Pre-mix speech + background
  - Input: synthesized.wav + background-audio.wav
  - Apply -8dB volume reduction to background (if ducking enabled)
  - Use amix to combine into premixed.wav

Pass 2: Mux onto video
  - Input: source.mp4 + premixed.wav
  - -c:v copy -c:a aac (no video re-encode)
  - Quality checks on output
```

### Health Check Architecture
```
server.py startup sequence:
  1. Load CosyVoice model -> MODEL = AutoModel(...)
  2. Load Demucs model -> SEPARATOR = demucs.api.Separator(model="htdemucs")
  3. Run warmup inference
  4. Set global flag: READY = True

GET /health:
  if READY: return {"ready": true, "status": "ok"}
  else: return {"ready": false, "status": "loading"}

Pipeline health check (cosyvoice.server.ts):
  - Before SYNTHESIZE: poll /health until {"ready": true} (up to 3 min)
  - Mid-synthesis failure detection: if TTS fails after previous success,
    poll /health to detect pod restart, wait for recovery, then resume
```

### TTS Retry Architecture
```
Per-segment retry (cosyvoice.server.ts):
  MAX_RETRIES = 5
  backoff = [2000, 4000, 8000, 16000, 30000] ms

  for attempt in 1..5:
    try: synthesize(text, ref, lang, lang, speed=1.0)
    catch:
      if isPodRestartError(err):
        waitForHealthReady(180000)  // 3 min, does NOT count as retry
        continue  // retry the same segment
      else:
        wait(backoff[attempt])
        continue

  // All retries exhausted: record failure, use silence
  failedSegments.push({ index: i, error: lastError.message })
```

### Anti-Patterns to Avoid
- **Using CosyVoice speed parameter for pacing:** Always synthesize at speed=1.0. The CosyVoice speed parameter degrades quality. Use FFmpeg atempo post-synthesis instead.
- **Mixing background audio inside the merge FFmpeg command:** This conflates ducking control with video muxing. Use two passes: pre-mix audio first, then mux.
- **Treating background extraction failure as pipeline failure:** Per D-07, background extraction is best-effort. Fall back to speech-only silently.
- **Counting pod recovery waits as segment retries:** Per D-10, pod restart recovery polling is separate from the 5-retry budget.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Audio source separation | FFmpeg bandpass/highpass filters | Demucs htdemucs model | AI separation is orders of magnitude better than frequency filtering for isolating vocals from music/ambient |
| Audio ducking | Custom envelope follower | FFmpeg `volume` filter with -8dB | Simple volume reduction is adequate for on/off ducking; sidechain compression adds complexity without benefit for a binary toggle |
| Exponential backoff | Manual delay calculation | Simple array lookup `[2000, 4000, 8000, 16000, 30000]` | Predictable, debuggable, matches D-11 exactly |
| Duration verification | Manual ffprobe parsing | Existing `ffmpeg.getDuration()` | Already in codebase and working |

**Key insight on ducking approach:** D-06 specifies a simple on/off toggle at -8dB. The `sidechaincompress` FFmpeg filter is designed for dynamic ducking (reducing background only when speech is present). However, since we are REPLACING the original speech with synthesized speech, and the speech timing is known from segments, we can use a simpler approach: just apply a flat -8dB volume reduction to the entire background track. The synthesized speech at full volume will naturally dominate during speech segments, and the -8dB background fills the gaps. This is simpler and more predictable than sidechain compression.

## Common Pitfalls

### Pitfall 1: Demucs Model Auto-Download on First Run
**What goes wrong:** Demucs downloads the htdemucs model weights (~300MB) on first inference if not pre-cached. This causes a long delay or timeout on the first `/separate` call.
**Why it happens:** The `demucs.api.Separator()` constructor downloads models lazily.
**How to avoid:** Pre-download the htdemucs model in the Dockerfile during build. Add a step after `pip install demucs`:
```python
# In download_model.py or a separate script
import demucs.api
separator = demucs.api.Separator(model="htdemucs")
# This triggers model download and caching
```
**Warning signs:** First separation call taking >60 seconds or timing out.

### Pitfall 2: VRAM Contention Between CosyVoice and Demucs
**What goes wrong:** If Demucs and CosyVoice both have models loaded on GPU simultaneously, VRAM may be exhausted on smaller GPUs.
**Why it happens:** CosyVoice uses ~4-6GB VRAM, htdemucs uses ~3-7GB. Combined could exceed 16GB GPUs.
**How to avoid:** Since SEPARATE_AUDIO runs BEFORE SYNTHESIZE in the pipeline, the models are used sequentially. Load Demucs model lazily (on first `/separate` call) or manage GPU memory explicitly. On RTX 4090 (24GB), both models can coexist. On smaller GPUs, consider loading Demucs only when needed and offloading CosyVoice.
**Warning signs:** CUDA out-of-memory errors during separation.

### Pitfall 3: Pod Restart During Synthesis Loop
**What goes wrong:** The RunPod pod restarts mid-synthesis (observed in production). The CosyVoice model re-downloads and re-warms up. Subsequent TTS calls fail with connection errors or `IN_QUEUE` responses until the pod recovers.
**Why it happens:** RunPod can preempt or restart pods for infrastructure reasons. The existing server.py re-downloads models from modelscope.cn on startup.
**How to avoid:** (1) The models are baked into the Docker image (already done per Dockerfile), so restart should be fast (~10s for warmup only). (2) The new `/health` endpoint only returns `{"ready": true}` AFTER warmup completes. (3) The pipeline detects mid-synthesis pod restarts by catching connection failures after a successful TTS call, then polls `/health` until ready before resuming.
**Warning signs:** Sequential segment failures after initial successes, connection refused errors.

### Pitfall 4: 16kHz Audio Sent to Demucs
**What goes wrong:** The existing `extractAudio()` produces 16kHz mono WAV. If this is sent to Demucs, the separation quality will be terrible because Demucs expects 44.1kHz audio.
**Why it happens:** D-03 explicitly requires extracting from the original video's audio stream at full quality.
**How to avoid:** Create a new `extractAudioFullQuality()` method that extracts at the source's native sample rate (or 44.1kHz stereo). Use this for Demucs input. Continue using the existing 16kHz extraction for transcription.
**Warning signs:** Background track sounds distorted or mostly silent.

### Pitfall 5: Prisma Enum Migration Ordering
**What goes wrong:** Adding `SEPARATE_AUDIO` to the `PipelineStep` enum in Prisma requires a migration. If the migration runs while existing jobs are in `PROCESSING` state, the database may reject writes with the old enum values.
**Why it happens:** PostgreSQL enum additions are safe (they only add, never remove), but the Prisma client must be regenerated.
**How to avoid:** Run the migration during a maintenance window or when no jobs are processing. The migration is purely additive (new enum value), so existing data is unaffected.
**Warning signs:** Prisma client type errors after migration.

### Pitfall 6: Garbage Background Detection
**What goes wrong:** Demucs produces a background track that is mostly silence (e.g., for a video with no background audio). The ducking logic then mixes silence + speech, which is correct but wasteful.
**Why it happens:** Not all videos have meaningful background audio.
**How to avoid:** After separation, check the background track's RMS level. If it's below a threshold (e.g., -60dB), skip the ducking/mixing step and proceed with speech-only audio. Use FFmpeg's `volumedetect` filter: `ffmpeg -i background.wav -af volumedetect -f null -`. Parse `mean_volume` from stderr.
**Warning signs:** Background track file size is suspiciously small (< a few KB for a multi-minute track).

### Pitfall 7: amix Volume Normalization
**What goes wrong:** FFmpeg's `amix` filter normalizes volume by default, reducing each input by `1/N` where N is the number of inputs. When mixing 2 tracks (speech + background), each gets reduced by -3dB, making the speech quieter than intended.
**Why it happens:** Default amix behavior divides volume by input count.
**How to avoid:** Use `amix=inputs=2:duration=longest:normalize=0` to disable auto-normalization. Then apply volume adjustments explicitly: background at -8dB, speech at 0dB.
**Warning signs:** Final output sounds noticeably quieter than the original video.

## Code Examples

### Demucs Python API Integration (server.py /separate endpoint)
```python
# Source: https://github.com/facebookresearch/demucs/blob/main/docs/api.md
import demucs.api
import torchaudio
import io

# Load once at startup (alongside CosyVoice model)
DEMUCS_SEPARATOR = None

def get_demucs_separator():
    global DEMUCS_SEPARATOR
    if DEMUCS_SEPARATOR is None:
        DEMUCS_SEPARATOR = demucs.api.Separator(model="htdemucs", device="cuda")
    return DEMUCS_SEPARATOR

@app.post("/separate")
async def separate_audio(audio: UploadFile = File(...)):
    """Separate audio into vocals and background using Demucs htdemucs."""
    fd, temp_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)

    try:
        with open(temp_path, "wb") as f:
            f.write(await audio.read())

        separator = get_demucs_separator()
        origin, separated = separator.separate_audio_file(temp_path)

        # htdemucs outputs: drums, bass, other, vocals
        # "background" = everything except vocals
        vocals = separated["vocals"]
        background = separated["drums"] + separated["bass"] + separated["other"]

        # Encode background to WAV bytes
        bg_io = io.BytesIO()
        torchaudio.save(bg_io, background.cpu(), separator.samplerate, format="wav")
        bg_bytes = bg_io.getvalue()

        # Encode vocals to WAV bytes
        vocals_io = io.BytesIO()
        torchaudio.save(vocals_io, vocals.cpu(), separator.samplerate, format="wav")
        vocals_bytes = vocals_io.getvalue()

        return JSONResponse({
            "background": base64.b64encode(bg_bytes).decode("ascii"),
            "vocals": base64.b64encode(vocals_bytes).decode("ascii"),
            "sample_rate": separator.samplerate,
        })
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
```

### Enhanced Health Endpoint (server.py)
```python
# Global readiness flag
READY = False

# After model loading and warmup:
READY = True

@app.get("/health")
def health_check():
    return {
        "ready": READY,
        "status": "ok" if READY else "loading",
        "model": "Fun-CosyVoice3-0.5B",
    }
```

### Health Check Polling (cosyvoice.server.ts pattern)
```typescript
async function waitForCosyVoiceHealth(
  baseUrl: string,  // e.g., https://{pod_id}-8000.proxy.runpod.net
  timeoutMs: number = 180000,
): Promise<void> {
  const healthUrl = baseUrl.replace(/\/synthesize$/, "/health");
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        if (data.ready === true) {
          console.log(`[cosyvoice] Health check passed in ${((Date.now() - start) / 1000).toFixed(1)}s`);
          return;
        }
      }
    } catch {
      // Connection refused or timeout -- pod not ready yet
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error("CosyVoice health check timed out after 3 minutes");
}
```

### FFmpeg Full-Quality Audio Extraction
```typescript
async extractAudioFullQuality(
  videoPath: string,
  translationId: string,
): Promise<string> {
  const outputDir = path.join(os.tmpdir(), "dubly", translationId);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "source-audio-full.wav");

  return new Promise((resolve, reject) => {
    Ffmpeg(videoPath)
      .noVideo()
      .audioChannels(2)       // stereo for Demucs
      .audioFrequency(44100)  // full quality
      .format("wav")
      .on("error", (err) =>
        reject(new Error(`FFmpeg full-quality extract failed: ${err.message}`))
      )
      .on("end", () => resolve(outputPath))
      .save(outputPath);
  });
}
```

### FFmpeg Simple Ducking (volume reduction)
```typescript
async duckBackground(
  backgroundPath: string,
  outputPath: string,
  duckDb: number = -8,
): Promise<string> {
  return new Promise((resolve, reject) => {
    Ffmpeg(backgroundPath)
      .audioFilters(`volume=${duckDb}dB`)
      .audioChannels(2)
      .audioFrequency(44100)
      .format("wav")
      .on("error", (err) =>
        reject(new Error(`FFmpeg duck failed: ${err.message}`))
      )
      .on("end", () => resolve(outputPath))
      .save(outputPath);
  });
}
```

### FFmpeg Pre-Mix Speech + Background
```typescript
async preMixAudio(
  speechPath: string,
  backgroundPath: string,
  outputPath: string,
): Promise<string> {
  const ffmpegBin = ffmpegPath ?? "ffmpeg";

  return new Promise((resolve, reject) => {
    // amix with normalize=0 to prevent auto-volume-reduction
    const args = [
      "-y",
      "-i", speechPath,
      "-i", backgroundPath,
      "-filter_complex",
      "[0:a][1:a]amix=inputs=2:duration=longest:normalize=0[out]",
      "-map", "[out]",
      "-ac", "2",
      "-ar", "44100",
      "-f", "wav",
      outputPath,
    ];

    const proc = spawn(ffmpegBin, args);
    let stderr = "";
    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg preMix failed (code ${code})`));
        return;
      }
      resolve(outputPath);
    });
    proc.on("error", (err) => reject(err));
  });
}
```

### Quality Check After Merge
```typescript
async verifyMergeOutput(
  outputPath: string,
  expectedDurationSec: number,
): Promise<{ valid: boolean; reason?: string }> {
  const stat = fs.statSync(outputPath);

  // Check 1: file size reasonable (> 1KB)
  if (stat.size < 1024) {
    return { valid: false, reason: `Output too small: ${stat.size} bytes` };
  }

  // Check 2: duration within tolerance
  const actualDuration = await ffmpeg.getDuration(outputPath);
  const drift = Math.abs(actualDuration - expectedDurationSec);
  if (drift > 2.0) {
    return { valid: false, reason: `Duration drift: ${drift.toFixed(1)}s (expected ${expectedDurationSec}s, got ${actualDuration.toFixed(1)}s)` };
  }

  // Check 3: has audio stream
  // Use ffprobe to verify audio stream exists
  return { valid: true };
}
```

### Garbage Background Detection Heuristic
```typescript
async isBackgroundMeaningful(
  backgroundPath: string,
): Promise<boolean> {
  const ffmpegBin = ffmpegPath ?? "ffmpeg";

  return new Promise((resolve) => {
    const args = [
      "-i", backgroundPath,
      "-af", "volumedetect",
      "-f", "null", "-",
    ];

    const proc = spawn(ffmpegBin, args);
    let stderr = "";
    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
    proc.on("close", () => {
      // Parse mean_volume from volumedetect output
      const match = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);
      if (match) {
        const meanDb = parseFloat(match[1]);
        // If mean volume is below -55dB, the track is essentially silence
        resolve(meanDb > -55);
      } else {
        // Can't determine -- assume meaningful
        resolve(true);
      }
    });
    proc.on("error", () => resolve(true));
  });
}
```

## Schema Changes Required

### Prisma Schema Updates
```prisma
// Add to PipelineStep enum:
enum PipelineStep {
  DOWNLOAD
  EXTRACT_AUDIO
  SEPARATE_AUDIO    // NEW: Demucs source separation
  TRANSCRIBE
  TRANSLATE
  CLONE_VOICE
  SYNTHESIZE
  MERGE
}

// Add to Translation model:
model Translation {
  // ... existing fields ...

  backgroundAudioKey  String?       // Tigris key for separated background audio
  enableBackgroundMix Boolean @default(true)  // Ducking toggle (D-06)
  failedSegments      Json?         // Array of {index: number, error: string}
  failedSegmentCount  Int     @default(0)     // Quick count for UI badge
}
```

### Progress Percentages (Rebalanced for 8 Steps)
```typescript
const STEP_PROGRESS: Record<PipelineStep, number> = {
  DOWNLOAD: 8,
  EXTRACT_AUDIO: 15,
  SEPARATE_AUDIO: 25,  // NEW
  TRANSCRIBE: 38,
  TRANSLATE: 50,
  CLONE_VOICE: 60,
  SYNTHESIZE: 80,
  MERGE: 95,
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fixed `avgCharsPerSec = 14` + `prosodySpeed` | Synthesize at speed=1.0, gap-aware stretching | This phase | Eliminates chipmunk/slow artifacts from bad speed estimation |
| 0.4x-2.5x atempo range | 0.7x-1.5x range with truncate+fade | This phase | More natural sounding; extreme stretching was unusable |
| 3 retries, 1-2s backoff | 5 retries, exponential 2-30s + pod restart detection | This phase | Handles RunPod pod restarts without losing the entire job |
| Simple audio replacement in merge | Pre-mix speech + ducked background, then mux | This phase | Preserves background audio (music, ambient) in final output |
| Single-quality audio extraction | Dual extraction: 16kHz for ASR, 44.1kHz for Demucs | This phase | Better source separation quality per D-03 |

**Deprecated/outdated:**
- `avgCharsPerSec = 14` constant: Remove entirely (D-19)
- `prosodySpeed` calculation: Remove entirely (D-19)
- `MAX_RATIO = 2.5` / `MIN_RATIO = 0.4` in timeStretchExact: Change to 1.5 / 0.7 (D-17)

## Open Questions

1. **Demucs Model Pre-Download in Docker Build**
   - What we know: The Dockerfile already has a `download_model.py` script for CosyVoice. We need to add Demucs model download.
   - What's unclear: Whether `demucs.api.Separator(model="htdemucs")` triggers download during construction, or if a separate download step is needed.
   - Recommendation: Add a Demucs initialization call in the Dockerfile's build step (similar to CosyVoice's download_model.py). Test by instantiating `Separator("htdemucs")` during build.

2. **COSYVOICE_URL Path for New Endpoints**
   - What we know: `COSYVOICE_URL` is currently set to `.../synthesize`. The `/health` and `/separate` endpoints need the base URL.
   - What's unclear: Whether to add a new env var or derive the base URL by stripping `/synthesize`.
   - Recommendation: Derive the base URL in code: `const baseUrl = env.COSYVOICE_URL.replace(/\/synthesize$/, "")`. This avoids adding new env vars and keeps backward compatibility.

3. **Background Audio File Size for Demucs Upload**
   - What we know: The full-quality audio extraction of a 10-minute video at 44.1kHz stereo is ~100MB WAV.
   - What's unclear: Whether the RunPod proxy can handle 100MB+ uploads to the `/separate` endpoint.
   - Recommendation: If the audio is too large, compress to FLAC before sending (lossless, ~30-50% smaller). Alternatively, upload via Tigris and send a presigned URL instead of the raw file.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| FFmpeg | Audio processing | Already in codebase (ffmpeg-static) | bundled | -- |
| Prisma | Schema migration | Already in codebase | existing | -- |
| demucs (Python) | Source separation | Needs install in Docker | 4.0.1 | Skip background preservation |
| RunPod GPU pod | CosyVoice + Demucs | Already provisioned | RTX 4090/A100 | -- |
| PyTorch CUDA | Demucs GPU acceleration | Already in Docker image | 12.4.1 | CPU mode (5-10x slower) |

**Missing dependencies with no fallback:**
- None. All external dependencies are either already available or are Python packages installable in the existing Docker image.

**Missing dependencies with fallback:**
- `demucs` Python package: Not yet in Docker image. Install via `pip install demucs` in Dockerfile. If install fails, background preservation can be skipped per D-07 (fall back to speech-only).

## Modification Inventory

### Files Modified

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add `SEPARATE_AUDIO` to PipelineStep enum; add `backgroundAudioKey`, `enableBackgroundMix`, `failedSegments`, `failedSegmentCount` to Translation model |
| `services/cosyvoice-api/server.py` | Upgrade `/health` to readiness-gated; add `POST /separate` endpoint with Demucs; add `READY` global flag; load Demucs model at startup |
| `services/cosyvoice-api/Dockerfile` | Add `pip install demucs` and Demucs model pre-download step |
| `services/cosyvoice-api/scripts/download_model.py` | Add Demucs model download (instantiate Separator to trigger cache) |
| `app/services/pipeline.server.ts` | Add `SEPARATE_AUDIO` step; rewrite `stepSynthesize` (remove prosodySpeed, speed=1.0, gap-aware pacing, per-segment 5-retry, pod restart detection, failed segment tracking); rewrite `stepMerge` (pre-mix with background, quality check); update `ORDERED_STEPS`, `STEP_PROGRESS`, `PipelineStep` type |
| `app/services/ffmpeg.server.ts` | Add `extractAudioFullQuality()`, `duckBackground()`, `preMixAudio()`, `verifyMergeOutput()`, `isBackgroundMeaningful()`; update `timeStretchExact()` limits from 0.4-2.5 to 0.7-1.5 |
| `app/services/cosyvoice.server.ts` | Change MAX_RETRIES from 2 to 5; change backoff to exponential [2s,4s,8s,16s,30s]; add health check method; add pod restart detection; always pass speed=1.0; add `/separate` client method |
| `app/utils/validation.ts` | Add `enableBackgroundMix` to `videoSubmitSchema` (optional boolean, default true) |
| `app/routes/platform/new-translation.tsx` | Add ducking toggle checkbox (below engine selector) |
| `app/routes/platform/translation.tsx` | Add failed segment warning display when `failedSegmentCount > 0` |
| `app/components/translation-progress.tsx` | Add `SEPARATE_AUDIO` to STEPS array |

### Files NOT Modified
| File | Reason |
|------|--------|
| `app/services/assemblyai.server.ts` | No changes needed; transcription uses existing 16kHz audio |
| `app/services/openai.server.ts` | Translation step unchanged |
| `app/services/fish-audio.server.ts` | Fish Audio path unchanged (pacing changes are in pipeline.server.ts) |
| `worker.ts` | Worker entrypoint unchanged; pipeline changes are internal |

## Sources

### Primary (HIGH confidence)
- [Demucs Python API docs](https://github.com/facebookresearch/demucs/blob/main/docs/api.md) -- Separator class, separate_audio_file method, model names
- [Demucs PyPI](https://pypi.org/project/demucs/) -- Version 4.0.1, installation
- [FFmpeg Filters Documentation](https://ffmpeg.org/ffmpeg-filters.html) -- sidechaincompress, volume, amix filters
- Existing codebase analysis -- pipeline.server.ts, ffmpeg.server.ts, cosyvoice.server.ts, server.py, Dockerfile

### Secondary (MEDIUM confidence)
- [FFmpeg sidechaincompress reference](https://ayosec.github.io/ffmpeg-filters-docs/8.0/Filters/Audio/sidechaincompress.html) -- Filter parameters for ducking
- [Demucs GPU requirements discussion](https://github.com/facebookresearch/demucs/issues/1) -- VRAM estimates for htdemucs
- [Demucs Docker examples](https://github.com/xserrat/docker-facebook-demucs) -- Docker integration patterns

### Tertiary (LOW confidence)
- Demucs optimized inference benchmarks (~5s for 3-min track on Ampere GPUs) -- from HuggingFace model card, specific performance numbers may vary

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Demucs is the industry standard for source separation; FFmpeg filters are well-documented
- Architecture: HIGH -- All changes build on existing pipeline patterns; no new infrastructure
- Pitfalls: HIGH -- Based on actual production issues mentioned in CONTEXT.md (pod restarts, IN_QUEUE bug, chipmunk audio)
- Schema changes: HIGH -- Additive migration, no breaking changes
- Demucs integration: MEDIUM -- API docs verified, but Docker image size impact and VRAM coexistence with CosyVoice need runtime validation

**Research date:** 2026-03-29
**Valid until:** 2026-04-28 (stable domain; Demucs 4.0.1 is archived/mature)
