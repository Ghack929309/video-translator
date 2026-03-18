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
   * Concatenate multiple audio files sequentially using an FFmpeg concat list.
   * Files should already be time-stretched and padded with silence segments.
   */
  async concatenateAudio(
    audioPaths: string[],
    outputPath: string,
  ): Promise<string> {
    if (audioPaths.length === 0)
      throw new Error("No audio files to concatenate");
    if (audioPaths.length === 1) {
      // Even for a single file, normalize to 44100Hz mono WAV
      return new Promise((resolve, reject) => {
        Ffmpeg(audioPaths[0])
          .audioChannels(1)
          .audioFrequency(44100)
          .format("wav")
          .on("error", (err) =>
            reject(new Error(`FFmpeg normalize failed: ${err.message}`)),
          )
          .on("end", () => resolve(outputPath))
          .save(outputPath);
      });
    }

    // Use filter_complex concat filter — properly resamples all inputs
    // to a consistent format before concatenating (unlike -f concat demuxer)
    const ffmpegBin = ffmpegPath ?? "ffmpeg";
    const args: string[] = ["-y"];

    // Add all inputs
    for (const p of audioPaths) {
      args.push("-i", p);
    }

    // Build filter: normalize each input to 44100Hz mono, then concat
    const filterParts = audioPaths.map(
      (_, i) =>
        `[${i}:a]aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=mono[a${i}]`,
    );
    const concatInputs = audioPaths.map((_, i) => `[a${i}]`).join("");
    const filter = [
      ...filterParts,
      `${concatInputs}concat=n=${audioPaths.length}:v=0:a=1[out]`,
    ].join(";");

    args.push("-filter_complex", filter);
    args.push("-map", "[out]");
    args.push("-ac", "1");
    args.push("-ar", "44100");
    args.push("-f", "wav");
    args.push(outputPath);

    console.log(
      `[ffmpeg] concat: ${audioPaths.length} files via filter_complex`,
    );

    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpegBin, args);
      let stderr = "";

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code: number | null) => {
        if (code !== 0) {
          console.error(`[ffmpeg] concat stderr:\n${stderr.slice(-500)}`);
          reject(new Error(`FFmpeg concat failed with code ${code}`));
          return;
        }
        const outSize = fs.statSync(outputPath).size;
        console.log(
          `[ffmpeg] Concatenated audio: ${(outSize / 1024).toFixed(0)}KB`,
        );
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
