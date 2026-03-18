import ffmpegPath from "ffmpeg-static";
import Ffmpeg from "fluent-ffmpeg";
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

    return new Promise((resolve, reject) => {
      Ffmpeg()
        .input(videoPath)
        .input(audioPath)
        .outputOptions([
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
          "-shortest",
        ])
        .on("start", (cmd) => console.log(`[ffmpeg] ${cmd}`))
        .on("error", (err) =>
          reject(new Error(`FFmpeg merge failed: ${err.message}`)),
        )
        .on("end", () => resolve(outputPath))
        .save(outputPath);
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
   * Generate a silent audio file of the given duration in seconds.
   */
  async generateSilence(
    durationSec: number,
    outputPath: string,
    sampleRate = 24000,
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
      fs.copyFileSync(audioPaths[0], outputPath);
      return outputPath;
    }

    // Write a concat list file
    const listPath = outputPath + ".list.txt";
    const listContent = audioPaths.map((p) => `file '${p}'`).join("\n");
    fs.writeFileSync(listPath, listContent);

    return new Promise((resolve, reject) => {
      Ffmpeg()
        .input(listPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .audioChannels(1)
        .format("wav")
        .on("start", (cmd) => console.log(`[ffmpeg] ${cmd}`))
        .on("error", (err) => {
          fs.unlinkSync(listPath);
          reject(new Error(`FFmpeg concat failed: ${err.message}`));
        })
        .on("end", () => {
          fs.unlinkSync(listPath);
          resolve(outputPath);
        })
        .save(outputPath);
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
