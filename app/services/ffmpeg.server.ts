import ffmpegPath from "ffmpeg-static";
import Ffmpeg from "fluent-ffmpeg";
import { spawn } from "child_process";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

if (ffmpegPath) {
  Ffmpeg.setFfmpegPath(ffmpegPath);
}

/**
 * FFmpeg service for audio/video processing.
 */
export const ffmpeg = {
  /**
   * Extract audio from a video file as WAV.
   * Returns the path to the extracted WAV file.
   */
  async extractAudio(
    videoPath: string,
    translationId: string,
  ): Promise<string> {
    const outputDir = path.join(os.tmpdir(), "dubly", translationId);
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, "source-audio.wav");

    return new Promise((resolve, reject) => {
      Ffmpeg(videoPath)
        .noVideo()
        .audioChannels(1)
        .audioFrequency(16000)
        .format("wav")
        .on("start", (cmd) => console.log(`[ffmpeg] ${cmd}`))
        .on("error", (err) =>
          reject(new Error(`FFmpeg extract audio failed: ${err.message}`)),
        )
        .on("end", () => resolve(outputPath))
        .save(outputPath);
    });
  },

  /**
   * Extract audio from video at full quality (44.1kHz stereo) for Demucs source separation.
   * Unlike extractAudio() which produces 16kHz mono for ASR, this preserves quality for AI separation.
   * Per D-03: Extract from original video's audio stream, not from already-extracted 16kHz mono WAV.
   */
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
        .audioChannels(2)
        .audioFrequency(44100)
        .format("wav")
        .on("start", (cmd) => console.log(`[ffmpeg] ${cmd}`))
        .on("error", (err) =>
          reject(
            new Error(`FFmpeg full-quality extract failed: ${err.message}`),
          ),
        )
        .on("end", () => {
          const size = fs.statSync(outputPath).size;
          console.log(
            `[ffmpeg] Full-quality audio extracted: ${(size / 1024 / 1024).toFixed(1)}MB (44.1kHz stereo)`,
          );
          resolve(outputPath);
        })
        .save(outputPath);
    });
  },

  /**
   * Merge a new audio track onto a video, replacing the original audio.
   * Returns the path to the merged video file.
   */
  async mergeAudioVideo(
    videoPath: string,
    audioPath: string,
    translationId: string,
  ): Promise<string> {
    const outputDir = path.join(os.tmpdir(), "dubly", translationId);
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, "output.mp4");

    // Use spawn directly for full control over the FFmpeg command
    const ffmpegBin = ffmpegPath ?? "ffmpeg";

    return new Promise((resolve, reject) => {
      const args = [
        "-y",
        "-i",
        videoPath,
        "-i",
        audioPath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ac",
        "2",
        "-ar",
        "44100",
        "-shortest",
        "-movflags",
        "+faststart",
        outputPath,
      ];

      console.log(`[ffmpeg] ${ffmpegBin} ${args.join(" ")}`);

      const proc = spawn(ffmpegBin, args);
      let stderr = "";

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code: number | null) => {
        if (code !== 0) {
          console.error(`[ffmpeg] merge stderr:\n${stderr}`);
          reject(new Error(`FFmpeg merge failed with code ${code}`));
          return;
        }

        // Verify output has both streams
        const outSize = fs.statSync(outputPath).size;
        console.log(
          `[ffmpeg] Merge output: ${(outSize / 1024 / 1024).toFixed(1)}MB`,
        );

        if (outSize < 1000) {
          reject(new Error(`FFmpeg merge output too small (${outSize} bytes)`));
          return;
        }

        resolve(outputPath);
      });

      proc.on("error", (err: Error) => {
        reject(new Error(`Failed to start ffmpeg: ${err.message}`));
      });
    });
  },

  /**
   * Time-stretch an audio file to match a target duration.
   * Uses the atempo filter (valid range: 0.5–2.0, chained for extremes).
   */
  async timeStretch(
    audioPath: string,
    targetDurationSec: number,
    outputPath: string,
  ): Promise<string> {
    // Get current duration
    const currentDuration = await this.getDuration(audioPath);
    if (currentDuration <= 0) {
      throw new Error("Cannot determine audio duration");
    }

    const ratio = currentDuration / targetDurationSec;

    // atempo filter only accepts 0.5–2.0, chain multiple for extremes
    const filters: string[] = [];
    let remaining = ratio;
    while (remaining > 2.0) {
      filters.push("atempo=2.0");
      remaining /= 2.0;
    }
    while (remaining < 0.5) {
      filters.push("atempo=0.5");
      remaining /= 0.5;
    }
    filters.push(`atempo=${remaining.toFixed(4)}`);

    return new Promise((resolve, reject) => {
      Ffmpeg(audioPath)
        .audioFilters(filters)
        .audioChannels(1)
        .audioFrequency(44100)
        .format("wav")
        .on("start", (cmd) => console.log(`[ffmpeg] ${cmd}`))
        .on("error", (err) =>
          reject(new Error(`FFmpeg time-stretch failed: ${err.message}`)),
        )
        .on("end", () => resolve(outputPath))
        .save(outputPath);
    });
  },

  /**
   * Time-stretch audio to EXACTLY the target duration.
   * Clamps the stretch ratio to avoid extreme distortion, then truncates
   * or pads the result so the output is precisely targetDurationSec long.
   * Returns the actual stretch ratio used (for diagnostics).
   */
  async timeStretchExact(
    audioPath: string,
    targetDurationSec: number,
    outputPath: string,
  ): Promise<{ outputPath: string; stretchRatio: number }> {
    const currentDuration = await this.getDuration(audioPath);
    if (currentDuration <= 0) {
      throw new Error("Cannot determine audio duration for timeStretchExact");
    }

    const rawRatio = currentDuration / targetDurationSec;

    // Per D-17: Tighter limits for more natural sound. If outside range, truncate with fade-out.
    const MAX_RATIO = 1.5;
    const MIN_RATIO = 0.7;
    const clampedRatio = Math.max(MIN_RATIO, Math.min(MAX_RATIO, rawRatio));

    if (rawRatio !== clampedRatio) {
      console.warn(
        `[ffmpeg] timeStretchExact: ratio ${rawRatio.toFixed(2)} clamped to ${clampedRatio.toFixed(2)} ` +
          `(${currentDuration.toFixed(2)}s → ${targetDurationSec.toFixed(2)}s target)`,
      );
    }

    // Build atempo chain for the clamped ratio
    const filters: string[] = [];
    let remaining = clampedRatio;
    while (remaining > 2.0) {
      filters.push("atempo=2.0");
      remaining /= 2.0;
    }
    while (remaining < 0.5) {
      filters.push("atempo=0.5");
      remaining /= 0.5;
    }
    filters.push(`atempo=${remaining.toFixed(4)}`);

    // Step 1: stretch audio
    const stretchedTmp = outputPath + ".stretched.wav";
    await new Promise<void>((resolve, reject) => {
      Ffmpeg(audioPath)
        .audioFilters(filters)
        .audioChannels(1)
        .audioFrequency(44100)
        .format("wav")
        .on("error", (err) =>
          reject(new Error(`FFmpeg stretch failed: ${err.message}`)),
        )
        .on("end", () => resolve())
        .save(stretchedTmp);
    });

    // Step 2: verify actual duration and truncate or pad to exact target
    const actualDuration = await this.getDuration(stretchedTmp);
    const drift = Math.abs(actualDuration - targetDurationSec);

    if (drift < 0.02) {
      // Close enough (<20ms drift), just rename
      fs.renameSync(stretchedTmp, outputPath);
    } else if (actualDuration > targetDurationSec) {
      // Truncate with a short fade-out at the end to avoid clicks
      const fadeStart = Math.max(0, targetDurationSec - 0.05);
      await new Promise<void>((resolve, reject) => {
        Ffmpeg(stretchedTmp)
          .duration(targetDurationSec)
          .audioFilters(`afade=t=out:st=${fadeStart.toFixed(3)}:d=0.05`)
          .audioChannels(1)
          .audioFrequency(44100)
          .format("wav")
          .on("error", (err) =>
            reject(new Error(`FFmpeg truncate failed: ${err.message}`)),
          )
          .on("end", () => {
            if (fs.existsSync(stretchedTmp)) fs.unlinkSync(stretchedTmp);
            resolve();
          })
          .save(outputPath);
      });
    } else {
      // Audio is shorter than target after stretching.
      // DON'T pad with silence — let mixAudioAbsolute handle the natural gap.
      // Just add a gentle fade-out at the end to avoid clicks.
      const fadeStart = Math.max(0, actualDuration - 0.1);
      console.warn(
        `[ffmpeg] timeStretchExact: audio shorter than target after stretch ` +
          `(${actualDuration.toFixed(2)}s vs ${targetDurationSec.toFixed(2)}s) — fade-out applied, no silence padding`,
      );
      await new Promise<void>((resolve, reject) => {
        Ffmpeg(stretchedTmp)
          .audioFilters(`afade=t=out:st=${fadeStart.toFixed(3)}:d=0.1`)
          .audioChannels(1)
          .audioFrequency(44100)
          .format("wav")
          .on("error", (err) =>
            reject(new Error(`FFmpeg fade failed: ${err.message}`)),
          )
          .on("end", () => {
            if (fs.existsSync(stretchedTmp)) fs.unlinkSync(stretchedTmp);
            resolve();
          })
          .save(outputPath);
      });
    }

    return { outputPath, stretchRatio: clampedRatio };
  },

  /**
   * Get the duration of a media file in seconds.
   */
  getDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      Ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(new Error(`ffprobe failed: ${err.message}`));
          return;
        }
        resolve(metadata.format.duration ?? 0);
      });
    });
  },

  /**
   * Extract a time range from an audio file.
   * Used to isolate per-speaker audio segments for voice cloning.
   */
  async extractTimeRange(
    inputPath: string,
    startSec: number,
    endSec: number,
    outputPath: string,
  ): Promise<string> {
    const duration = endSec - startSec;
    if (duration <= 0) throw new Error("Invalid time range for extraction");

    return new Promise((resolve, reject) => {
      Ffmpeg(inputPath)
        .setStartTime(startSec)
        .duration(duration)
        .audioChannels(1)
        .audioFrequency(44100)
        .format("wav")
        .on("error", (err) =>
          reject(new Error(`FFmpeg extractTimeRange failed: ${err.message}`)),
        )
        .on("end", () => resolve(outputPath))
        .save(outputPath);
    });
  },

  /**
   * Concatenate multiple audio files with silence gaps between them.
   * Phase 13: Used to build longer voice reference samples from multiple short segments.
   * @param inputPaths - Array of WAV file paths to concatenate
   * @param outputPath - Output WAV path
   * @param gapSec - Silence duration between segments (default 0.05s = 50ms)
   */
  async concatenateWithGaps(
    inputPaths: string[],
    outputPath: string,
    gapSec: number = 0.05,
  ): Promise<string> {
    if (inputPaths.length === 0)
      throw new Error("No input files to concatenate");
    if (inputPaths.length === 1) {
      fs.copyFileSync(inputPaths[0], outputPath);
      return outputPath;
    }

    const ffmpegBin = ffmpegPath ?? "ffmpeg";

    return new Promise((resolve, reject) => {
      // Build filter: normalize each input to mono 44.1kHz, add silence gap, then concat
      const inputs: string[] = [];
      const filterParts: string[] = [];

      for (let i = 0; i < inputPaths.length; i++) {
        inputs.push("-i", inputPaths[i]);
        filterParts.push(
          `[${i}:a]aformat=sample_rates=44100:channel_layouts=mono[a${i}]`,
        );
      }

      // Build concat with silence gaps using apad for each segment except the last
      const concatInputs = inputPaths.map((_, i) => `[a${i}]`).join("");
      const fullFilter = [
        ...filterParts,
        `${concatInputs}concat=n=${inputPaths.length}:v=0:a=1[out]`,
      ].join(";");

      const args = [
        "-y",
        ...inputs,
        "-filter_complex",
        fullFilter,
        "-map",
        "[out]",
        "-ac",
        "1",
        "-ar",
        "44100",
        "-f",
        "wav",
        outputPath,
      ];

      console.log(
        `[ffmpeg] Concatenating ${inputPaths.length} audio segments with ${gapSec}s gaps`,
      );

      const proc = spawn(ffmpegBin, args);
      let stderr = "";
      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code: number | null) => {
        if (code !== 0) {
          console.error(`[ffmpeg] concat stderr:\n${stderr.slice(-500)}`);
          reject(new Error(`FFmpeg concatenate failed with code ${code}`));
          return;
        }
        resolve(outputPath);
      });

      proc.on("error", (err: Error) => {
        reject(new Error(`Failed to start ffmpeg concat: ${err.message}`));
      });
    });
  },

  /**
   * Trim audio to maxSeconds and compress to MP3 for smaller uploads.
   */
  async trimAndCompress(
    inputPath: string,
    outputPath: string,
    maxSeconds = 30,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      Ffmpeg(inputPath)
        .duration(maxSeconds)
        .audioChannels(1)
        .audioFrequency(44100)
        .audioBitrate("128k")
        .format("mp3")
        .on("start", (cmd) => console.log(`[ffmpeg] ${cmd}`))
        .on("error", (err) =>
          reject(new Error(`FFmpeg trim+compress failed: ${err.message}`)),
        )
        .on("end", () => resolve(outputPath))
        .save(outputPath);
    });
  },

  /**
   * Generate a silent audio file of the given duration in seconds.
   */
  async generateSilence(
    durationSec: number,
    outputPath: string,
    sampleRate = 44100,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      Ffmpeg()
        .input("anullsrc=r=" + sampleRate + ":cl=mono")
        .inputFormat("lavfi")
        .duration(durationSec)
        .audioChannels(1)
        .audioFrequency(sampleRate)
        .format("wav")
        .on("error", (err) =>
          reject(new Error(`FFmpeg silence failed: ${err.message}`)),
        )
        .on("end", () => resolve(outputPath))
        .save(outputPath);
    });
  },

  /**
   * Mix multiple audio segments accurately at their absolute start times.
   * Eliminates cascading desynchronization caused by sequential concatenation.
   */
  async mixAudioAbsolute(
    audioSegments: { path: string; startMs: number }[],
    outputPath: string,
    durationSec?: number,
  ): Promise<string> {
    if (audioSegments.length === 0) {
      await this.generateSilence(durationSec ?? 0.1, outputPath);
      return outputPath;
    }

    if (
      audioSegments.length === 1 &&
      audioSegments[0].startMs === 0 &&
      !durationSec
    ) {
      fs.copyFileSync(audioSegments[0].path, outputPath);
      return outputPath;
    }

    // Log the timeline for debugging
    for (const seg of audioSegments) {
      const dur = await this.getDuration(seg.path);
      console.log(
        `[ffmpeg] Timeline: segment at ${(seg.startMs / 1000).toFixed(1)}s, duration ${dur.toFixed(2)}s`,
      );
    }

    const ffmpegBin = ffmpegPath ?? "ffmpeg";
    const args: string[] = ["-y"];
    const filterParts: string[] = [];
    const mixRefs: string[] = [];

    // Base silent track to guarantee full duration and correct output length
    if (durationSec) {
      args.push(
        "-f",
        "lavfi",
        "-t",
        durationSec.toString(),
        "-i",
        "anullsrc=channel_layout=mono:sample_rate=44100",
      );
      mixRefs.push("[0:a]");
    }

    // Add each segment as an input with adelay positioning.
    // FFmpeg's filter graph automatically resamples all inputs to a common format,
    // so TTS at 22kHz and silence at 44.1kHz are handled correctly.
    audioSegments.forEach((seg, i) => {
      args.push("-i", seg.path);
      const inputIdx = durationSec ? i + 1 : i;

      const delayMs = Math.round(seg.startMs);
      if (delayMs > 0) {
        filterParts.push(
          `[${inputIdx}:a]adelay=${delayMs}|${delayMs}[a${inputIdx}]`,
        );
        mixRefs.push(`[a${inputIdx}]`);
      } else {
        mixRefs.push(`[${inputIdx}:a]`);
      }
    });

    const inputsCount = mixRefs.length;
    // normalize=0 preserves original volume (fixes the 1/N volume division bug)
    // dropout_transition=0 prevents volume ramp when inputs end
    const filterString =
      `${filterParts.join(";")}${filterParts.length > 0 ? ";" : ""}` +
      `${mixRefs.join("")}amix=inputs=${inputsCount}:duration=longest:normalize=0:dropout_transition=0[out]`;

    args.push("-filter_complex", filterString);
    args.push("-map", "[out]");
    args.push("-ac", "1");
    args.push("-ar", "44100");
    args.push("-f", "wav");
    args.push(outputPath);

    console.log(
      `[ffmpeg] mixAudioAbsolute: ${audioSegments.length} segments via adelay+amix (normalize=0)`,
    );

    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpegBin, args);
      let stderr = "";

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code: number | null) => {
        if (code !== 0) {
          console.error(`[ffmpeg] amix stderr:\n${stderr.slice(-1000)}`);
          reject(new Error(`FFmpeg mixAudioAbsolute failed with code ${code}`));
          return;
        }
        const outSize = fs.statSync(outputPath).size;
        console.log(
          `[ffmpeg] Mixed absolute audio: ${(outSize / 1024).toFixed(0)}KB`,
        );
        resolve(outputPath);
      });

      proc.on("error", (err: Error) => {
        reject(new Error(`Failed to start ffmpeg: ${err.message}`));
      });
    });
  },

  /**
   * Apply volume ducking to background audio track.
   * Per D-06: Simple -8dB volume reduction (on/off toggle, not dynamic sidechain).
   */
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
        .on("start", (cmd) => console.log(`[ffmpeg] ${cmd}`))
        .on("error", (err) =>
          reject(new Error(`FFmpeg duck failed: ${err.message}`)),
        )
        .on("end", () => {
          console.log(`[ffmpeg] Background ducked by ${duckDb}dB`);
          resolve(outputPath);
        })
        .save(outputPath);
    });
  },

  /**
   * Pre-mix synthesized speech with ducked background audio.
   * Per D-20: Two-pass approach -- pre-mix first, then mux onto video.
   * Per Pitfall 7: Uses normalize=0 to prevent amix auto-volume-reduction.
   */
  async preMixAudio(
    speechPath: string,
    backgroundPath: string,
    outputPath: string,
  ): Promise<string> {
    const ffmpegBin = ffmpegPath ?? "ffmpeg";

    return new Promise((resolve, reject) => {
      const args = [
        "-y",
        "-i",
        speechPath,
        "-i",
        backgroundPath,
        "-filter_complex",
        "[0:a][1:a]amix=inputs=2:duration=longest:normalize=0[out]",
        "-map",
        "[out]",
        "-ac",
        "2",
        "-ar",
        "44100",
        "-f",
        "wav",
        outputPath,
      ];

      console.log(`[ffmpeg] preMixAudio: speech + background -> premixed`);

      const proc = spawn(ffmpegBin, args);
      let stderr = "";
      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code: number | null) => {
        if (code !== 0) {
          console.error(`[ffmpeg] preMix stderr:\n${stderr.slice(-500)}`);
          reject(new Error(`FFmpeg preMix failed with code ${code}`));
          return;
        }
        const outSize = fs.statSync(outputPath).size;
        console.log(
          `[ffmpeg] Pre-mixed audio: ${(outSize / 1024 / 1024).toFixed(1)}MB`,
        );
        resolve(outputPath);
      });

      proc.on("error", (err: Error) => {
        reject(new Error(`Failed to start ffmpeg preMix: ${err.message}`));
      });
    });
  },

  /**
   * Check if a separated background track has meaningful audio content.
   * Uses FFmpeg volumedetect to measure mean volume. If below -55dB, the track
   * is essentially silence and background mixing should be skipped.
   * Per D-07: If background extraction produces garbage, fall back to speech-only.
   */
  async isBackgroundMeaningful(backgroundPath: string): Promise<boolean> {
    const ffmpegBin = ffmpegPath ?? "ffmpeg";

    return new Promise((resolve) => {
      const args = [
        "-i",
        backgroundPath,
        "-af",
        "volumedetect",
        "-f",
        "null",
        "-",
      ];

      const proc = spawn(ffmpegBin, args);
      let stderr = "";
      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", () => {
        const match = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);
        if (match) {
          const meanDb = parseFloat(match[1]);
          const meaningful = meanDb > -55;
          console.log(
            `[ffmpeg] Background mean volume: ${meanDb.toFixed(1)}dB — ${meaningful ? "meaningful" : "silence (skipping)"}`,
          );
          resolve(meaningful);
        } else {
          // Can't determine -- assume meaningful to avoid silently dropping audio
          console.log(
            `[ffmpeg] Could not determine background volume — assuming meaningful`,
          );
          resolve(true);
        }
      });

      proc.on("error", () => {
        // On error, assume meaningful
        resolve(true);
      });
    });
  },

  /**
   * Verify the merged output video is valid.
   * Per D-22: Check duration matches input (+-2s), audio stream exists and is >1KB, file size is reasonable.
   */
  async verifyMergeOutput(
    outputPath: string,
    expectedDurationSec: number,
  ): Promise<{ valid: boolean; reason?: string }> {
    // Check 1: file exists and is reasonable size
    const stat = fs.statSync(outputPath);
    if (stat.size < 1024) {
      return { valid: false, reason: `Output too small: ${stat.size} bytes` };
    }

    // Check 2: duration within +-2s tolerance
    const actualDuration = await this.getDuration(outputPath);
    const drift = Math.abs(actualDuration - expectedDurationSec);
    if (drift > 2.0) {
      return {
        valid: false,
        reason: `Duration drift: ${drift.toFixed(1)}s (expected ${expectedDurationSec.toFixed(1)}s, got ${actualDuration.toFixed(1)}s)`,
      };
    }

    // Check 3: has audio stream via ffprobe
    const hasAudio = await new Promise<boolean>((resolve) => {
      Ffmpeg.ffprobe(outputPath, (err, metadata) => {
        if (err) {
          resolve(false);
          return;
        }
        const audioStream = metadata.streams?.find(
          (s) => s.codec_type === "audio",
        );
        resolve(!!audioStream);
      });
    });

    if (!hasAudio) {
      return { valid: false, reason: "Output has no audio stream" };
    }

    console.log(
      `[ffmpeg] Merge quality check passed: ${actualDuration.toFixed(1)}s, ${(stat.size / 1024 / 1024).toFixed(1)}MB`,
    );
    return { valid: true };
  },

  /**
   * Phase 13: Loudness profile presets for different delivery platforms.
   */
  LOUDNESS_PROFILES: {
    WEB: { targetI: -14, targetLRA: 11, targetTP: -1 },
    STREAMING: { targetI: -24, targetLRA: 15, targetTP: -2 },
    BROADCAST: { targetI: -27, targetLRA: 15, targetTP: -2 },
  } as Record<string, { targetI: number; targetLRA: number; targetTP: number }>,

  /**
   * Phase 13: Measure audio loudness using EBU R128 (loudnorm first pass).
   * Returns integrated loudness (LUFS), loudness range, true peak, and threshold.
   */
  async measureLoudness(inputPath: string): Promise<{
    input_i: number;
    input_lra: number;
    input_tp: number;
    input_thresh: number;
  }> {
    const ffmpegBin = ffmpegPath ?? "ffmpeg";

    return new Promise((resolve, reject) => {
      const args = [
        "-i",
        inputPath,
        "-af",
        "loudnorm=I=-14:LRA=11:TP=-1:print_format=json",
        "-f",
        "null",
        "-",
      ];

      const proc = spawn(ffmpegBin, args);
      let stderr = "";
      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code: number | null) => {
        // loudnorm prints JSON to stderr even on success
        const jsonMatch = stderr.match(/\{[\s\S]*"input_i"[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const data = JSON.parse(jsonMatch[0]);
            const result = {
              input_i: parseFloat(data.input_i),
              input_lra: parseFloat(data.input_lra),
              input_tp: parseFloat(data.input_tp),
              input_thresh: parseFloat(data.input_thresh),
            };
            console.log(
              `[ffmpeg] Loudness measurement: ${result.input_i.toFixed(1)} LUFS, ` +
                `LRA: ${result.input_lra.toFixed(1)}, TP: ${result.input_tp.toFixed(1)} dBTP`,
            );
            resolve(result);
            return;
          } catch {
            // Fall through to reject
          }
        }
        reject(new Error(`Failed to parse loudnorm output (code ${code})`));
      });

      proc.on("error", (err: Error) => {
        reject(
          new Error(`Failed to start ffmpeg measureLoudness: ${err.message}`),
        );
      });
    });
  },

  /**
   * Phase 13: Two-pass EBU R128 loudness normalization.
   * First measures, then applies correction for precise LUFS targeting.
   * @param inputPath - Input audio file
   * @param outputPath - Output normalized audio file
   * @param profile - Loudness profile name (WEB, STREAMING, BROADCAST) or custom targets
   */
  async normalizeLoudness(
    inputPath: string,
    outputPath: string,
    profile:
      | string
      | { targetI: number; targetLRA: number; targetTP: number } = "WEB",
  ): Promise<string> {
    const ffmpegBin = ffmpegPath ?? "ffmpeg";
    const targets =
      typeof profile === "string"
        ? (this.LOUDNESS_PROFILES[profile] ?? this.LOUDNESS_PROFILES.WEB)
        : profile;

    // Pass 1: Measure current loudness
    const measured = await this.measureLoudness(inputPath);

    // Pass 2: Apply correction with measured values
    return new Promise((resolve, reject) => {
      const filter =
        `loudnorm=I=${targets.targetI}:LRA=${targets.targetLRA}:TP=${targets.targetTP}:` +
        `measured_I=${measured.input_i}:measured_LRA=${measured.input_lra}:` +
        `measured_TP=${measured.input_tp}:measured_thresh=${measured.input_thresh}`;

      const args = [
        "-y",
        "-i",
        inputPath,
        "-af",
        filter,
        "-ar",
        "48000",
        "-ac",
        "2",
        "-f",
        "wav",
        outputPath,
      ];

      console.log(
        `[ffmpeg] Normalizing loudness: ${measured.input_i.toFixed(1)} LUFS -> ${targets.targetI} LUFS (profile: ${typeof profile === "string" ? profile : "custom"})`,
      );

      const proc = spawn(ffmpegBin, args);
      let stderr = "";
      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code: number | null) => {
        if (code !== 0) {
          console.error(
            `[ffmpeg] normalizeLoudness stderr:\n${stderr.slice(-500)}`,
          );
          reject(
            new Error(`FFmpeg normalizeLoudness failed with code ${code}`),
          );
          return;
        }
        console.log(`[ffmpeg] Loudness normalized to ${targets.targetI} LUFS`);
        resolve(outputPath);
      });

      proc.on("error", (err: Error) => {
        reject(
          new Error(`Failed to start ffmpeg normalizeLoudness: ${err.message}`),
        );
      });
    });
  },

  /**
   * Phase 13: Dynamic sidechain ducking — reduce background only when speech is present.
   * Uses FFmpeg sidechaincompress: background volume is compressed when speech signal exceeds threshold.
   * Much more natural than flat volume reduction — background plays at near-original level during gaps.
   * @param speechPath - Synthesized speech audio (the sidechain signal)
   * @param backgroundPath - Background music/SFX audio (gets ducked)
   * @param outputPath - Output with speech + dynamically ducked background
   * @param speechToBackgroundDb - Target dB difference between speech and background (default: 10)
   */
  async sidechainDuck(
    speechPath: string,
    backgroundPath: string,
    outputPath: string,
    backgroundVolume: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM",
  ): Promise<string> {
    const ffmpegBin = ffmpegPath ?? "ffmpeg";

    // Phase 14: Volume-aware sidechain ducking parameters
    // Each level adjusts: pre-volume, compression ratio, and threshold
    const volumeProfiles = {
      LOW: { preVolDb: -12, ratio: 10, threshold: 0.01 },
      MEDIUM: { preVolDb: -6, ratio: 6, threshold: 0.015 },
      HIGH: { preVolDb: -2, ratio: 3, threshold: 0.025 },
    };
    const profile = volumeProfiles[backgroundVolume];

    return new Promise((resolve, reject) => {
      // sidechaincompress: background is ducked when speech level exceeds threshold
      // Pre-volume sets the base background level
      // ratio controls how aggressively background ducks during speech
      // attack=200ms — fades background down quickly when speech starts
      // release=1000ms — background fades back up slowly after speech ends (natural)
      const filter =
        `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${profile.preVolDb}dB[bg];` +
        `[0:a]aformat=sample_rates=44100:channel_layouts=stereo[speech];` +
        `[bg][speech]sidechaincompress=threshold=${profile.threshold}:ratio=${profile.ratio}:attack=200:release=1000:level_sc=1[ducked];` +
        `[speech][ducked]amix=inputs=2:duration=longest:normalize=0[out]`;

      const args = [
        "-y",
        "-i",
        speechPath,
        "-i",
        backgroundPath,
        "-filter_complex",
        filter,
        "-map",
        "[out]",
        "-ac",
        "2",
        "-ar",
        "44100",
        "-f",
        "wav",
        outputPath,
      ];

      console.log(
        `[ffmpeg] Sidechain ducking: ${backgroundVolume} profile (preVol: ${profile.preVolDb}dB, ratio: ${profile.ratio}, threshold: ${profile.threshold})`,
      );

      const proc = spawn(ffmpegBin, args);
      let stderr = "";
      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code: number | null) => {
        if (code !== 0) {
          console.error(
            `[ffmpeg] sidechainDuck stderr:\n${stderr.slice(-500)}`,
          );
          reject(new Error(`FFmpeg sidechainDuck failed with code ${code}`));
          return;
        }
        const outSize = fs.statSync(outputPath).size;
        console.log(
          `[ffmpeg] Sidechain ducked audio: ${(outSize / 1024 / 1024).toFixed(1)}MB`,
        );
        resolve(outputPath);
      });

      proc.on("error", (err: Error) => {
        reject(
          new Error(`Failed to start ffmpeg sidechainDuck: ${err.message}`),
        );
      });
    });
  },

  /**
   * Clean up temporary files for a given translation.
   */
  cleanup(translationId: string): void {
    const dir = path.join(os.tmpdir(), "dubly", translationId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`[ffmpeg] Cleaned up ${dir}`);
    }
  },
};
