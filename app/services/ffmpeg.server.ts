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

    // Clamp: don't speed up beyond 2.5x or slow down beyond 0.4x
    // Beyond these limits, audio quality degrades severely
    const MAX_RATIO = 2.5;
    const MIN_RATIO = 0.4;
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
      // Pad with silence to reach exact target
      const padDuration = targetDurationSec - actualDuration;
      const padPath = outputPath + ".pad.wav";
      await this.generateSilence(padDuration, padPath);
      await this.mixAudioAbsolute([{ path: stretchedTmp, startMs: 0 }, { path: padPath, startMs: actualDuration * 1000 }], outputPath);
      if (fs.existsSync(stretchedTmp)) fs.unlinkSync(stretchedTmp);
      if (fs.existsSync(padPath)) fs.unlinkSync(padPath);
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

    if (audioSegments.length === 1 && audioSegments[0].startMs === 0 && !durationSec) {
      // Just copy it
      fs.copyFileSync(audioSegments[0].path, outputPath);
      return outputPath;
    }

    const ffmpegBin = ffmpegPath ?? "ffmpeg";
    const args: string[] = ["-y"];
    const filterParts: string[] = [];
    const mixRefs: string[] = [];

    // Base silent track to guarantee full duration
    if (durationSec) {
      args.push("-f", "lavfi", "-t", durationSec.toString(), "-i", "anullsrc=channel_layout=mono:sample_rate=44100");
      mixRefs.push("[0:a]");
    }

    // Add inputs and setup adelay filters
    audioSegments.forEach((seg, i) => {
      args.push("-i", seg.path);
      const inputIdx = durationSec ? i + 1 : i;
      
      const delayMs = Math.round(seg.startMs);
      if (delayMs > 0) {
        // [1:a]adelay=1000|1000[a1]
        filterParts.push(`[${inputIdx}:a]adelay=${delayMs}|${delayMs}[a${inputIdx}]`);
        mixRefs.push(`[a${inputIdx}]`);
      } else {
        mixRefs.push(`[${inputIdx}:a]`);
      }
    });

    const inputsCount = mixRefs.length;
    // amix duration=longest to avoid cutting off trailing overlaps
    const filterString = `${filterParts.join(";")}${filterParts.length > 0 ? ";" : ""}${mixRefs.join("")}amix=inputs=${inputsCount}:duration=longest[out]`;

    args.push("-filter_complex", filterString);
    args.push("-map", "[out]");
    args.push("-ac", "1");
    args.push("-ar", "44100");
    args.push("-f", "wav");
    args.push(outputPath);

    console.log(`[ffmpeg] mixAudioAbsolute: ${audioSegments.length} tracks via amix`);

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
        console.log(`[ffmpeg] Mixed absolute audio: ${(outSize / 1024).toFixed(0)}KB`);
        resolve(outputPath);
      });

      proc.on("error", (err: Error) => {
        reject(new Error(`Failed to start ffmpeg: ${err.message}`));
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
