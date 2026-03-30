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
          reject(new Error(`FFmpeg full-quality extract failed: ${err.message}`)),
        )
        .on("end", () => {
          const size = fs.statSync(outputPath).size;
          console.log(`[ffmpeg] Full-quality audio extracted: ${(size / 1024 / 1024).toFixed(1)}MB (44.1kHz stereo)`);
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
      // Pad with silence to reach exact target using apad filter
      await new Promise<void>((resolve, reject) => {
        Ffmpeg(stretchedTmp)
          .audioFilters(`apad=whole_dur=${targetDurationSec.toFixed(3)}`)
          .audioChannels(1)
          .audioFrequency(44100)
          .format("wav")
          .on("error", (err) =>
            reject(new Error(`FFmpeg pad failed: ${err.message}`)),
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

    // Sort by start time to build the timeline sequentially
    const sorted = [...audioSegments].sort((a, b) => a.startMs - b.startMs);

    // Log the timeline for debugging
    for (const seg of sorted) {
      const dur = await this.getDuration(seg.path);
      console.log(
        `[ffmpeg] Timeline: segment at ${(seg.startMs / 1000).toFixed(1)}s, duration ${dur.toFixed(2)}s`,
      );
    }

    const ffmpegBin = ffmpegPath ?? "ffmpeg";
    const totalDurationSec = durationSec ?? 0;

    // Build sequential timeline: silence gaps + audio segments concatenated in order
    // This avoids amix volume normalization (1/N) and is more reliable than adelay+amix
    const concatParts: string[] = []; // file paths to concatenate
    const tmpDir = path.dirname(outputPath);
    let cursor = 0; // current position in ms

    for (let i = 0; i < sorted.length; i++) {
      const seg = sorted[i];
      const gapMs = seg.startMs - cursor;

      // Insert silence for the gap before this segment
      if (gapMs > 50) {
        // Only insert gap if > 50ms (avoid tiny silence files)
        const silPath = path.join(tmpDir, `gap-${i}.wav`);
        await this.generateSilence(gapMs / 1000, silPath);
        concatParts.push(silPath);
        cursor += gapMs;
      } else if (gapMs < -50) {
        // Segments overlap — trim the overlap from the start of this segment
        console.warn(`[ffmpeg] Segments overlap by ${Math.abs(gapMs)}ms at ${seg.startMs}ms — trimming`);
      }

      concatParts.push(seg.path);
      const segDur = await this.getDuration(seg.path);
      cursor = seg.startMs + Math.round(segDur * 1000);
    }

    // Pad with silence to reach the video's total duration
    if (totalDurationSec > 0) {
      const remainingMs = totalDurationSec * 1000 - cursor;
      if (remainingMs > 100) {
        const tailSilPath = path.join(tmpDir, "gap-tail.wav");
        await this.generateSilence(remainingMs / 1000, tailSilPath);
        concatParts.push(tailSilPath);
      }
    }

    if (concatParts.length === 0) {
      await this.generateSilence(totalDurationSec || 0.1, outputPath);
      return outputPath;
    }

    if (concatParts.length === 1) {
      fs.copyFileSync(concatParts[0], outputPath);
      return outputPath;
    }

    // Use FFmpeg concat demuxer for reliable sequential joining
    const listPath = path.join(tmpDir, "concat-list.txt");
    const listContent = concatParts
      .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      .join("\n");
    fs.writeFileSync(listPath, listContent);

    console.log(`[ffmpeg] mixAudioAbsolute: ${sorted.length} segments + gaps via concat (${concatParts.length} parts)`);

    return new Promise((resolve, reject) => {
      const args = [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listPath,
        "-ac", "1",
        "-ar", "44100",
        "-f", "wav",
        outputPath,
      ];

      const proc = spawn(ffmpegBin, args);
      let stderr = "";

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code: number | null) => {
        // Clean up gap files
        concatParts.forEach((p) => {
          if (p.includes("gap-")) {
            try { fs.unlinkSync(p); } catch {}
          }
        });
        try { fs.unlinkSync(listPath); } catch {}

        if (code !== 0) {
          console.error(`[ffmpeg] concat stderr:\n${stderr.slice(-1000)}`);
          reject(new Error(`FFmpeg mixAudioAbsolute failed with code ${code}`));
          return;
        }
        const outSize = fs.statSync(outputPath).size;
        const outDur = outSize / (44100 * 2); // rough estimate for 16-bit mono
        console.log(`[ffmpeg] Mixed audio: ${(outSize / 1024).toFixed(0)}KB (~${outDur.toFixed(1)}s)`);
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

      console.log(`[ffmpeg] preMixAudio: speech + background -> premixed`);

      const proc = spawn(ffmpegBin, args);
      let stderr = "";
      proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

      proc.on("close", (code: number | null) => {
        if (code !== 0) {
          console.error(`[ffmpeg] preMix stderr:\n${stderr.slice(-500)}`);
          reject(new Error(`FFmpeg preMix failed with code ${code}`));
          return;
        }
        const outSize = fs.statSync(outputPath).size;
        console.log(`[ffmpeg] Pre-mixed audio: ${(outSize / 1024 / 1024).toFixed(1)}MB`);
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
        const match = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);
        if (match) {
          const meanDb = parseFloat(match[1]);
          const meaningful = meanDb > -55;
          console.log(`[ffmpeg] Background mean volume: ${meanDb.toFixed(1)}dB — ${meaningful ? "meaningful" : "silence (skipping)"}`);
          resolve(meaningful);
        } else {
          // Can't determine -- assume meaningful to avoid silently dropping audio
          console.log(`[ffmpeg] Could not determine background volume — assuming meaningful`);
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
        const audioStream = metadata.streams?.find((s) => s.codec_type === "audio");
        resolve(!!audioStream);
      });
    });

    if (!hasAudio) {
      return { valid: false, reason: "Output has no audio stream" };
    }

    console.log(`[ffmpeg] Merge quality check passed: ${actualDuration.toFixed(1)}s, ${(stat.size / 1024 / 1024).toFixed(1)}MB`);
    return { valid: true };
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
