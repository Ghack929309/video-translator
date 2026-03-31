import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { env } from "~/utils/env.server";
import type { TranscriptSegment } from "~/services/assemblyai.server";

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

/**
 * Map language codes to full names so GPT gets unambiguous instructions.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese (Mandarin)",
  ru: "Russian",
  ar: "Arabic",
  hi: "Hindi",
  nl: "Dutch",
  pl: "Polish",
  tr: "Turkish",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
  sv: "Swedish",
  uk: "Ukrainian",
  ht: "Haitian Creole",
};

function getLanguageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

/**
 * Phase 13: Language-specific speaking rates (characters per second of speech).
 * Used to compute target character counts for length-aware translation.
 * Sources: empirical dubbing industry averages + TTS benchmarks.
 */
const CHARS_PER_SECOND: Record<string, number> = {
  en: 14,
  fr: 14,
  es: 15,
  de: 14,
  it: 15,
  pt: 15,
  ja: 8,
  ko: 12,
  zh: 6,
  ru: 14,
  ar: 13,
  hi: 13,
  nl: 14,
  pl: 14,
  tr: 14,
  vi: 13,
  th: 12,
  id: 14,
  sv: 14,
  uk: 14,
  ht: 14,
};

function getCharsPerSecond(langCode: string): number {
  return CHARS_PER_SECOND[langCode] ?? 14;
}

/**
 * A translated segment preserving the original timing.
 */
export interface TranslatedSegment {
  originalText: string;
  translatedText: string;
  start: number; // ms
  end: number; // ms
  speaker?: string;
}

const TranslatedSegmentSchema = z.object({
  segments: z.array(
    z.object({
      index: z.number(),
      translatedText: z.string(),
    }),
  ),
});

/**
 * Rough word count for a string.
 */
function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Build batches with a target max word count per batch.
 * This prevents sending huge segments to GPT that cause summarization.
 */
function buildWordAwareBatches(
  segments: TranscriptSegment[],
  maxWordsPerBatch: number,
  maxSegmentsPerBatch: number,
): TranscriptSegment[][] {
  const batches: TranscriptSegment[][] = [];
  let currentBatch: TranscriptSegment[] = [];
  let currentWords = 0;

  for (const segment of segments) {
    const segWords = wordCount(segment.text);

    // If a single segment exceeds the limit, give it its own batch
    if (segWords > maxWordsPerBatch) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentWords = 0;
      }
      batches.push([segment]);
      continue;
    }

    // If adding this segment would exceed limits, flush the batch
    if (
      currentWords + segWords > maxWordsPerBatch ||
      currentBatch.length >= maxSegmentsPerBatch
    ) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }
      currentBatch = [];
      currentWords = 0;
    }

    currentBatch.push(segment);
    currentWords += segWords;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * OpenAI service — translate transcript segments via GPT-4o-mini.
 */
export const openaiService = {
  /**
   * Translate an array of transcript segments to the target language.
   * Uses word-aware batching to avoid GPT summarization on long segments.
   * Returns translated segments with original timing preserved.
   */
  async translateSegments(
    segments: TranscriptSegment[],
    targetLanguage: string,
    sourceLanguage?: string | null,
  ): Promise<TranslatedSegment[]> {
    const MAX_WORDS_PER_BATCH = 300;
    const MAX_SEGMENTS_PER_BATCH = 15;

    const batches = buildWordAwareBatches(
      segments,
      MAX_WORDS_PER_BATCH,
      MAX_SEGMENTS_PER_BATCH,
    );

    const allTranslated: TranslatedSegment[] = [];
    let globalIndex = 0;

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      console.log(
        `[openai] Translating batch ${b + 1}/${batches.length} (${batch.length} segments, ~${batch.reduce((sum, s) => sum + wordCount(s.text), 0)} words)`,
      );

      const translated = await this.translateBatch(
        batch,
        globalIndex,
        targetLanguage,
        sourceLanguage,
      );
      allTranslated.push(...translated);
      globalIndex += batch.length;
    }

    return allTranslated;
  },

  /**
   * Translate a batch of segments using structured output.
   * Retries with individual segments if the batch translation is suspiciously short.
   */
  async translateBatch(
    segments: TranscriptSegment[],
    startIndex: number,
    targetLanguage: string,
    sourceLanguage?: string | null,
  ): Promise<TranslatedSegment[]> {
    const result = await this.callTranslationAPI(
      segments,
      startIndex,
      targetLanguage,
      sourceLanguage,
    );

    // Validate: check if translated output is suspiciously short
    const originalWords = segments.reduce(
      (sum, s) => sum + wordCount(s.text),
      0,
    );
    const translatedWords = result.reduce(
      (sum, s) => sum + wordCount(s.translatedText),
      0,
    );

    // If translation is less than 30% of original word count, it's likely summarized
    if (originalWords > 20 && translatedWords < originalWords * 0.3) {
      console.warn(
        `[openai] Translation suspiciously short: ${originalWords} original words → ${translatedWords} translated words. Retrying segment-by-segment.`,
      );

      // Retry each segment individually
      const retried: TranslatedSegment[] = [];
      for (let i = 0; i < segments.length; i++) {
        const single = await this.callTranslationAPI(
          [segments[i]],
          startIndex + i,
          targetLanguage,
          sourceLanguage,
        );
        retried.push(...single);
      }
      return retried;
    }

    return result;
  },

  /**
   * Call the OpenAI API to translate segments.
   * Phase 13: Now includes per-segment character count targets for length-aware translation.
   */
  async callTranslationAPI(
    segments: TranscriptSegment[],
    startIndex: number,
    targetLanguage: string,
    sourceLanguage?: string | null,
  ): Promise<TranslatedSegment[]> {
    const cps = getCharsPerSecond(targetLanguage);

    // Phase 13: Build segment list with character count targets
    const segmentList = segments
      .map((s, i) => {
        const durationSec = (s.end - s.start) / 1000;
        const targetChars = Math.round(durationSec * cps);
        return `[${startIndex + i}] (target: ~${targetChars} chars, ${durationSec.toFixed(1)}s) ${s.text}`;
      })
      .join("\n");

    const targetLangName = getLanguageName(targetLanguage);
    const sourceLangName = sourceLanguage
      ? getLanguageName(sourceLanguage)
      : null;
    const sourceLangNote = sourceLangName
      ? `The source audio is in ${sourceLangName}. `
      : "";

    const completion = await client.chat.completions.parse({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a professional video dubbing translator specializing in isochronous dubbing. ${sourceLangNote}Translate ALL of the following speech segments into ${targetLangName}.

CRITICAL RULES:
- Translate EVERY WORD of each segment completely. Do NOT summarize, shorten, or omit any content.
- EVERY segment MUST be translated into ${targetLangName}. Never output text in any other language.
- If a segment is already in ${targetLangName}, still return it (clean it up if needed).
- If a segment is in a third language (neither source nor target), translate it into ${targetLangName} anyway.
- Preserve the meaning, tone, and register of the original speech.
- Keep translations natural and conversational — this will be spoken aloud as dubbed audio.
- Handle idioms by finding equivalent expressions in ${targetLangName}.
- Do NOT add or remove segments. Translate each segment indexed exactly as given.
- Return ONLY the translated text for each segment index.

LENGTH MATCHING (CRITICAL FOR DUBBING):
- Each segment shows a target character count in parentheses (e.g. "target: ~42 chars, 3.0s").
- Your translation for each segment MUST be within ±15% of the shown target character count.
- This is essential because the translated text will be synthesized as speech that must fit the original video timing.
- Use shorter or longer synonyms, rephrase idioms, or adjust sentence structure to match the target length.
- If a direct translation is too short, expand with natural filler words or more descriptive phrasing.
- If a direct translation is too long, use concise synonyms or restructure the sentence.
- Do NOT sacrifice meaning — find natural phrasing in ${targetLangName} that fits the duration.`,
        },
        {
          role: "user",
          content: segmentList,
        },
      ],
      response_format: zodResponseFormat(
        TranslatedSegmentSchema,
        "translation",
      ),
      max_tokens: 16384,
      temperature: 0.3,
    });

    const choice = completion.choices[0];
    if (!choice?.message?.parsed) {
      const finishReason = choice?.finish_reason;
      throw new Error(
        `OpenAI returned no parsed response (finish_reason: ${finishReason})`,
      );
    }

    // Warn if truncated
    if (choice.finish_reason === "length") {
      console.warn(
        `[openai] Response truncated (finish_reason: length) for batch starting at index ${startIndex}`,
      );
    }

    const parsed = choice.message.parsed.segments;

    // Map back to TranslatedSegment with timing from originals
    const results = segments.map((original, i) => {
      const match = parsed.find((p) => p.index === startIndex + i);
      return {
        originalText: original.text,
        translatedText: match?.translatedText ?? original.text,
        start: original.start,
        end: original.end,
        speaker: original.speaker,
      };
    });

    // Phase 13: Post-translation length validation
    const LENGTH_TOLERANCE = 0.2; // 20% tolerance for warnings
    const outliers: {
      index: number;
      actual: number;
      target: number;
      ratio: number;
    }[] = [];
    for (let i = 0; i < results.length; i++) {
      const seg = segments[i];
      const durationSec = (seg.end - seg.start) / 1000;
      const targetChars = Math.round(durationSec * cps);
      const actualChars = results[i].translatedText.length;
      if (targetChars > 0) {
        const ratio = actualChars / targetChars;
        if (Math.abs(ratio - 1) > LENGTH_TOLERANCE) {
          outliers.push({
            index: startIndex + i,
            actual: actualChars,
            target: targetChars,
            ratio,
          });
        }
      }
    }
    if (outliers.length > 0) {
      console.warn(
        `[openai] ${outliers.length} segment(s) outside ±${(LENGTH_TOLERANCE * 100).toFixed(0)}% length target: ` +
          outliers
            .map(
              (o) =>
                `[${o.index}] ${o.actual}/${o.target} chars (${((o.ratio - 1) * 100).toFixed(0)}%)`,
            )
            .join(", "),
      );
    }

    return results;
  },
};
