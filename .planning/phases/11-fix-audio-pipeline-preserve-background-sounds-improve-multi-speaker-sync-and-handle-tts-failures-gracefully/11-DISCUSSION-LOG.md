# Phase 11: Fix audio pipeline — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-29
**Phase:** 11-fix-audio-pipeline-preserve-background-sounds-improve-multi-speaker-sync-and-handle-tts-failures-gracefully
**Areas discussed:** Background audio preservation, TTS failure handling, Multi-speaker sync & pacing, Merge strategy

---

## Background Audio Preservation

### Separation Method
| Option | Description | Selected |
|--------|-------------|----------|
| FFmpeg vocal isolation | Use FFmpeg's built-in audio filters for center-channel extraction. No external API, fast, decent quality. | |
| AI-based source separation | Use Demucs or Spleeter for proper AI vocal/instrumental separation. Higher quality. | ✓ |
| You decide | Claude picks based on constraints. | |

**User's choice:** AI-based source separation
**Notes:** User wants higher quality separation.

### Background Volume
| Option | Description | Selected |
|--------|-------------|----------|
| Duck background during speech | Lower BG volume -6dB to -12dB during speech. Netflix/professional approach. | |
| Full volume always | Keep BG at original volume throughout. | |
| Configurable ducking | Let user choose ducking level per translation. | ✓ |

**User's choice:** Configurable ducking

### Background Source
| Option | Description | Selected |
|--------|-------------|----------|
| Extract from original video audio | Work with original audio stream, highest quality. | ✓ |
| Extract from existing extracted WAV | Reuse already-extracted 16kHz mono WAV. Lower quality. | |

**User's choice:** Extract from original video audio

### Background Fallback
| Option | Description | Selected |
|--------|-------------|----------|
| Silent fallback — speech only | Fall back to current behavior if extraction fails. | ✓ |
| Fail the step | Mark step as failed, let user retry. | |

**User's choice:** Silent fallback

### AI Separation Tool
| Option | Description | Selected |
|--------|-------------|----------|
| Demucs (Meta/Facebook) | Best quality, ~1.5GB model, 4-stem separation. | ✓ |
| Spleeter (Deezer) | Lighter, decent quality, ~200MB model. | |
| You decide | Claude picks. | |

**User's choice:** Demucs

### Ducking Configuration
| Option | Description | Selected |
|--------|-------------|----------|
| Simple toggle: on/off (default: on) | BG ducking on by default (-8dB). Users can turn off. | ✓ |
| 3-level slider: none/light/heavy | Three options with different dB levels. | |
| Percentage slider: 0-100% | Full granular control. | |

**User's choice:** Simple toggle (on/off)

### Pipeline Step Design
| Option | Description | Selected |
|--------|-------------|----------|
| New step: SEPARATE_AUDIO | Add new step between EXTRACT_AUDIO and TRANSCRIBE. | ✓ |
| Extend EXTRACT_AUDIO | Add separation to existing step 2. | |

**User's choice:** New step: SEPARATE_AUDIO

### Infrastructure
| Option | Description | Selected |
|--------|-------------|----------|
| On Fly.io worker (CPU) | Run Demucs on CPU in worker Docker container. | |
| Dedicated RunPod GPU endpoint | Run on GPU via RunPod serverless. | |
| Same pod as CosyVoice | Run Demucs on the existing RunPod pod alongside CosyVoice. | ✓ |

**User's choice:** Same RunPod pod as CosyVoice (custom answer)

### API Design
| Option | Description | Selected |
|--------|-------------|----------|
| Separate /separate endpoint | Add new POST /separate endpoint on FastAPI server. | ✓ |
| Pre-process in TTS endpoint | Bundle into existing TTS call. | |

**User's choice:** Separate /separate endpoint

### Background Caching
| Option | Description | Selected |
|--------|-------------|----------|
| Cache in Tigris | Store separated BG track for reuse across translations. | |
| Re-separate each time | Run Demucs fresh for every translation. | ✓ |

**User's choice:** Re-separate each time

### Demucs Model Variant
| Option | Description | Selected |
|--------|-------------|----------|
| htdemucs | Hybrid Transformer, best quality, standard speed. | ✓ |
| htdemucs_ft | Fine-tuned, slightly better but slower. | |
| You decide | Claude picks. | |

**User's choice:** htdemucs

---

## TTS Failure Handling

### IN_QUEUE Handling
| Option | Description | Selected |
|--------|-------------|----------|
| Switch to /run + poll | Use async endpoint with polling. | |
| Increase runsync timeout + retries | Keep /runsync with more retries. | |
| You decide | Claude picks. | |

**User's choice:** Custom — Pod is restarting mid-process (model re-download from modelscope.cn). Need to handle pod restarts specifically.
**Notes:** User shared RunPod logs showing the CosyVoice server re-downloading models and doing warmup (~10s). During this window, all requests fail with IN_QUEUE. Current 3 retries at 1-2s delays is far too short.

### TTS Segment Failure
| Option | Description | Selected |
|--------|-------------|----------|
| Fail entire job | If any segment fails, mark translation as FAILED. | |
| Use original audio for failed segments | Splice untranslated audio for failed segments. | |
| Continue with silence + warn user | Silent gap for failed segments, warn user. | ✓ |

**User's choice:** Continue with silence + warn user

### Pre-flight Check
| Option | Description | Selected |
|--------|-------------|----------|
| Health check before SYNTHESIZE | Ping health endpoint, wait up to 3 min. | ✓ |
| Handle per-segment | Let each segment handle its own retry. | |

**User's choice:** Health check before SYNTHESIZE

### Batching
| Option | Description | Selected |
|--------|-------------|----------|
| Batch all segments | Send all segments in one request. | |
| Keep per-segment | Individual segment requests. | ✓ |

**User's choice:** Keep per-segment

### Health Endpoint
| Option | Description | Selected |
|--------|-------------|----------|
| Add lightweight /health | GET /health returns ready after model loaded + warmup. | ✓ |
| Use /synthesize for health | Send test synthesis as health check. | |

**User's choice:** Add lightweight /health (initially picked "use existing" but decided to add /health anyway for Demucs readiness too)

### Pod Restart Detection
| Option | Description | Selected |
|--------|-------------|----------|
| Pause and wait for recovery | Wait up to 3 min polling /health, resume from failed segment. | ✓ |
| Re-queue entire job | Kill pipeline run, re-enqueue. | |
| You decide | Claude picks. | |

**User's choice:** Pause and wait for pod recovery

### Retry Strategy
| Option | Description | Selected |
|--------|-------------|----------|
| 5 retries, exponential 2s-30s | 5 attempts: 2s, 4s, 8s, 16s, 30s. ~60s total. | ✓ |
| 10 retries, linear 5s each | 10 attempts, 5s gap. ~50s total. | |
| You decide | Claude picks. | |

**User's choice:** 5 retries, exponential 2s-30s

### Failed Segment Tracking
| Option | Description | Selected |
|--------|-------------|----------|
| Track in DB + show in UI | Store failed indices + errors, surface warning. | ✓ |
| Log only | Console warnings only. | |

**User's choice:** Track in DB + show in UI

### Failure Abort Threshold
| Option | Description | Selected |
|--------|-------------|----------|
| Abort if >50% fail | If more than half segments fail, abort job. | ✓ |
| Abort if >3 consecutive fail | 3 in a row = assume pod down. | |
| Never abort | Always produce output. | |

**User's choice:** Abort if >50% segments fail

---

## Multi-Speaker Sync & Pacing

### Language Pacing Strategy
| Option | Description | Selected |
|--------|-------------|----------|
| Language-specific chars/sec table | Lookup table per language for duration prediction. | |
| Measure actual TTS duration, adapt | Two-pass: synthesize, measure, re-synthesize if needed. | |
| Use CosyVoice speed parameter | Let TTS engine handle pacing natively. | |
| Single-pass at speed=1.0 + post-stretch | Always synthesize natural speed, stretch with FFmpeg after. | ✓ |

**User's choice:** Initially picked CosyVoice speed parameter, then clarified: synthesize at natural speed, only use FFmpeg stretch if there's no silence gap after the speech.

### Stretch Limits
| Option | Description | Selected |
|--------|-------------|----------|
| Tighter: 0.7-1.5x | More natural sound, closer to Netflix quality. | ✓ |
| Current: 0.4-2.5x | Keep existing limits. | |
| No stretching at all | Let speed parameter handle all pacing. | |

**User's choice:** Tighter 0.7-1.5x

### Overflow Handling
| Option | Description | Selected |
|--------|-------------|----------|
| Increase speed + mild stretch | Multi-step: speed param, then stretch, then truncate. | |
| Allow overflow into silence gap | Let speech extend if gap exists before next segment. | ✓ |
| Always truncate at boundary | Hard-cut at segment end time. | |

**User's choice:** Allow overflow into silence gap

### Speed Calculation
| Option | Description | Selected |
|--------|-------------|----------|
| Two-pass: natural then adjust | Synthesize, measure, re-synthesize. Most accurate. | |
| Single-pass with language table | Predict with per-language lookup, set speed once. | |
| Single-pass at speed=1.0 + post-stretch | Always natural speed, stretch only when needed. | ✓ |

**User's choice:** Single-pass at speed=1.0 + post-stretch

### Speaker Overlap
| Option | Description | Selected |
|--------|-------------|----------|
| Layer overlapping segments | Mix both audio tracks at absolute positions. | ✓ |
| Prevent overlap by truncating | Truncate speaker A when speaker B starts. | |

**User's choice:** Layer overlapping segments

### Per-Language Speed Limits
| Option | Description | Selected |
|--------|-------------|----------|

**User's choice:** Custom — "Use FFmpeg to stretch only if there is no silence after the speech." No per-language speed limits; pacing is handled by gap detection + selective stretching.

---

## Merge Strategy

### Mix Method
| Option | Description | Selected |
|--------|-------------|----------|
| Pre-mix audio, then mux | Combine speech + ducked BG first, then replace video audio. | ✓ |
| Single FFmpeg command | Complex filter graph in one pass. | |
| You decide | Claude picks. | |

**User's choice:** Pre-mix audio, then mux onto video

### Video Codec
| Option | Description | Selected |
|--------|-------------|----------|
| Copy video, encode audio only | -c:v copy, only encode new audio to AAC. Fast, no quality loss. | ✓ |
| Re-encode everything | Re-encode both streams. Slow, quality loss on video. | |

**User's choice:** Copy video, encode audio only

### Quality Check
| Option | Description | Selected |
|--------|-------------|----------|
| Verify duration + audio presence | Check output duration ±2s, audio >1KB, reasonable file size. | ✓ |
| Trust the pipeline | If FFmpeg exits 0, it's fine. | |

**User's choice:** Verify duration + audio presence

### Debug Files
| Option | Description | Selected |
|--------|-------------|----------|
| Keep in /tmp, delete after | Intermediate files in /tmp for debugging, cleaned up on success. | ✓ |
| Upload to Tigris | Store intermediate files for inspection. | |

**User's choice:** Keep in /tmp during processing, delete after

---

## Claude's Discretion

- Exact Demucs API request/response format
- Ducking implementation details
- Background extraction failure detection heuristic
- Quality check thresholds
- Pipeline step progress percentages
- Schema changes for failed segments and ducking preference

## Deferred Ideas

None — discussion stayed within phase scope
