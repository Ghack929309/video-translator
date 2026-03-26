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
 * OpenAI service — translate transcript segments via GPT-4o-mini.
 */
export const openaiService = {
  /**
   * Translate an array of transcript segments to the target language.
   * Processes in batches to stay within context limits.
   * Returns translated segments with original timing preserved.
   */
  async translateSegments(
    segments: TranscriptSegment[],
    targetLanguage: string,
    sourceLanguage?: string | null,
  ): Promise<TranslatedSegment[]> {
    const BATCH_SIZE = 20;
    const allTranslated: TranslatedSegment[] = [];

    for (let i = 0; i < segments.length; i += BATCH_SIZE) {
      const batch = segments.slice(i, i + BATCH_SIZE);
      const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(segments.length / BATCH_SIZE);

      console.log(
        `[openai] Translating batch ${batchIndex}/${totalBatches} (${batch.length} segments)`,
      );

      const translated = await this.translateBatch(
        batch,
        i,
        targetLanguage,
        sourceLanguage,
      );
      allTranslated.push(...translated);
    }

    return allTranslated;
  },

  /**
   * Translate a batch of segments using structured output.
   */
  async translateBatch(
    segments: TranscriptSegment[],
    startIndex: number,
    targetLanguage: string,
    sourceLanguage?: string | null,
  ): Promise<TranslatedSegment[]> {
    const segmentList = segments
      .map((s, i) => `[${startIndex + i}] ${s.text}`)
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
          content: `You are a professional video dubbing translator. ${sourceLangNote}Translate ALL of the following speech segments into ${targetLangName}.

CRITICAL RULES:
- EVERY segment MUST be translated into ${targetLangName}. Never output text in any other language.
- If a segment is already in ${targetLangName}, still return it (clean it up if needed).
- If a segment is in a third language (neither source nor target), translate it into ${targetLangName} anyway.
- Preserve the meaning, tone, and register of the original speech.
- Keep translations natural and conversational — this will be spoken aloud.
- Maintain roughly similar length to the original (the translated audio must fit the same time window).
- Handle idioms by finding equivalent expressions in ${targetLangName}.
- Do NOT add or remove segments. Translate each segment indexed exactly as given.
- Return ONLY the translated text for each segment index.`,
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
      temperature: 0.3,
    });

    const message = completion.choices[0]?.message;
    if (!message?.parsed) {
      throw new Error("OpenAI returned no parsed response");
    }

    const parsed = message.parsed.segments;

    // Map back to TranslatedSegment with timing from originals
    return segments.map((original, i) => {
      const match = parsed.find((p) => p.index === startIndex + i);
      return {
        originalText: original.text,
        translatedText: match?.translatedText ?? original.text,
        start: original.start,
        end: original.end,
        speaker: original.speaker,
      };
    });
  },
};
