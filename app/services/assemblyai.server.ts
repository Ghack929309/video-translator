import { AssemblyAI } from "assemblyai";
import { env } from "~/utils/env.server";

const client = new AssemblyAI({ apiKey: env.ASSEMBLYAI_API_KEY });

/**
 * A single word with timing information from AssemblyAI.
 */
export interface TranscriptWord {
  text: string;
  start: number; // ms
  end: number; // ms
  confidence: number;
}

/**
 * A segment of the transcript — a sentence or phrase with timing.
 */
export interface TranscriptSegment {
  text: string;
  start: number; // ms
  end: number; // ms
  words: TranscriptWord[];
}

/**
 * Full transcript result.
 */
export interface TranscriptResult {
  text: string;
  segments: TranscriptSegment[];
  words: TranscriptWord[];
  languageCode: string | null;
}

/**
 * AssemblyAI service — transcribe audio with word-level timestamps.
 */
export const assemblyai = {
  /**
   * Transcribe an audio file from a URL (e.g. a Tigris presigned URL).
   * Returns structured transcript with word timestamps grouped into segments.
   */
  async transcribe(audioUrl: string): Promise<TranscriptResult> {
    console.log("[assemblyai] Submitting audio for transcription...");

    const transcript = await client.transcripts.transcribe({
      audio: audioUrl,
      speech_models: ["universal-3-pro", "universal-2"],
      language_detection: true,
    });

    if (transcript.status === "error") {
      throw new Error(`AssemblyAI transcription failed: ${transcript.error}`);
    }

    const words: TranscriptWord[] = (transcript.words ?? []).map((w) => ({
      text: w.text,
      start: w.start,
      end: w.end,
      confidence: w.confidence,
    }));

    // Group words into segments using sentence boundaries from utterances
    // or fall back to splitting by pauses > 500ms
    const segments = groupWordsIntoSegments(words);

    console.log(
      `[assemblyai] Transcription complete: ${words.length} words, ${segments.length} segments`,
    );

    return {
      text: transcript.text ?? "",
      segments,
      words,
      languageCode: transcript.language_code ?? null,
    };
  },
};

/**
 * Group words into segments by detecting pauses > 500ms between words.
 * Each segment is a natural phrase or sentence chunk.
 */
function groupWordsIntoSegments(words: TranscriptWord[]): TranscriptSegment[] {
  if (words.length === 0) return [];

  const PAUSE_THRESHOLD_MS = 500;
  const segments: TranscriptSegment[] = [];
  let currentWords: TranscriptWord[] = [words[0]];

  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    if (gap > PAUSE_THRESHOLD_MS) {
      // Flush current segment
      segments.push(buildSegment(currentWords));
      currentWords = [];
    }
    currentWords.push(words[i]);
  }

  // Flush last segment
  if (currentWords.length > 0) {
    segments.push(buildSegment(currentWords));
  }

  return segments;
}

function buildSegment(words: TranscriptWord[]): TranscriptSegment {
  return {
    text: words.map((w) => w.text).join(" "),
    start: words[0].start,
    end: words[words.length - 1].end,
    words,
  };
}
