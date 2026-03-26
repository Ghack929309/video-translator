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
  speaker?: string;
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
      speaker_labels: true,
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

    // Use utterances (speaker-labeled) when available, fall back to pause-based grouping
    let segments: TranscriptSegment[];
    const utterances = transcript.utterances ?? [];

    if (utterances.length > 0) {
      segments = utterances.map((u) => ({
        text: u.text,
        start: u.start,
        end: u.end,
        speaker: u.speaker,
        words: (u.words ?? []).map((w) => ({
          text: w.text,
          start: w.start,
          end: w.end,
          confidence: w.confidence,
        })),
      }));
    } else {
      segments = groupWordsIntoSegments(words);
    }

    // Smooth speaker labels to fix isolated misdetections.
    // If a single segment has a different speaker than both its neighbors,
    // it's likely a diarization error — correct it to match neighbors.
    segments = smoothSpeakerLabels(segments);

    const speakers = new Set(segments.map((s) => s.speaker).filter(Boolean));
    console.log(
      `[assemblyai] Transcription complete: ${words.length} words, ${segments.length} segments, ${speakers.size} speaker(s)`,
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

/**
 * Smooth speaker labels to correct isolated misdetections.
 * Uses two passes:
 * 1. If a single segment has a different speaker than BOTH neighbors, flip it.
 * 2. For short segments (<1.5s) that differ from the previous AND next speaker
 *    which agree with each other, flip to match the surrounding context.
 */
function smoothSpeakerLabels(
  segments: TranscriptSegment[],
): TranscriptSegment[] {
  if (segments.length < 3) return segments;

  const result = segments.map((s) => ({ ...s }));
  let corrections = 0;

  for (let i = 1; i < result.length - 1; i++) {
    const prev = result[i - 1].speaker;
    const curr = result[i].speaker;
    const next = result[i + 1].speaker;

    if (!curr || !prev || !next) continue;

    // Both neighbors agree but current differs → likely a misdetection
    if (prev === next && curr !== prev) {
      const durationSec = (result[i].end - result[i].start) / 1000;
      // For short segments, always correct. For longer ones, only if < 3s.
      if (durationSec < 3) {
        result[i].speaker = prev;
        corrections++;
      }
    }
  }

  // Second pass: correct pairs of segments sandwiched between same-speaker blocks
  // e.g. A A B B A A → the two B's might be misdetections if they are short
  for (let i = 1; i < result.length - 1; i++) {
    const prev = result[i - 1].speaker;
    const curr = result[i].speaker;

    if (!curr || !prev) continue;

    // Check if this is a short isolated run (1-2 segments) between same-speaker blocks
    if (curr !== prev) {
      // Find the end of this different-speaker run
      let runEnd = i;
      while (runEnd < result.length && result[runEnd].speaker === curr) {
        runEnd++;
      }
      const runLength = runEnd - i;

      // If it's a short run (1-2 segments) and the speaker after matches before
      if (
        runLength <= 2 &&
        runEnd < result.length &&
        result[runEnd].speaker === prev
      ) {
        // Check total duration of the run
        const runDuration = (result[runEnd - 1].end - result[i].start) / 1000;
        if (runDuration < 2) {
          for (let j = i; j < runEnd; j++) {
            result[j].speaker = prev;
            corrections++;
          }
        }
      }
    }
  }

  if (corrections > 0) {
    console.log(`[assemblyai] Smoothed ${corrections} speaker label(s)`);
  }

  return result;
}
