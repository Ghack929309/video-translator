import { spawn } from "child_process";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

interface DownloadResult {
  filePath: string;
  mimeType: string;
}

/**
 * Download a video from a URL using yt-dlp.
 * Returns the path to the downloaded file in /tmp.
 */
export const ytdlp = {
  async download(url: string, videoId: string): Promise<DownloadResult> {
    const outputDir = path.join(os.tmpdir(), "dubly", videoId);
    fs.mkdirSync(outputDir, { recursive: true });

    const outputTemplate = path.join(outputDir, "source.%(ext)s");

    return new Promise((resolve, reject) => {
      const proc = spawn("yt-dlp", [
        "--no-playlist",
        "--format",
        "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format",
        "mp4",
        "--output",
        outputTemplate,
        url,
      ]);

      let stderr = "";

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.stdout.on("data", (data) => {
        console.log(`[yt-dlp] ${data.toString().trim()}`);
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
          return;
        }

        // Find the downloaded file
        const files = fs.readdirSync(outputDir);
        const sourceFile = files.find((f) => f.startsWith("source."));

        if (!sourceFile) {
          reject(new Error("yt-dlp completed but no output file found"));
          return;
        }

        resolve({
          filePath: path.join(outputDir, sourceFile),
          mimeType: "video/mp4",
        });
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to start yt-dlp: ${err.message}`));
      });
    });
  },
};
