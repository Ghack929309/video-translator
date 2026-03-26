import * as fs from "fs";
import { env } from "~/utils/env.server";

const BASE_URL = "https://api.fish.audio";

function headers(contentType?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${env.FISH_AUDIO_API_KEY}`,
  };
  if (contentType) h["Content-Type"] = contentType;
  return h;
}

/**
 * S2 Pro inline control hints for native pronunciation per target language.
 * These instruct the model to speak with a native accent rather than
 * carrying over the source speaker's accent.
 */
const LANGUAGE_HINTS: Record<string, string> = {
  en: "[speak with a native American English accent, clear and natural]",
  fr: "[parle avec un accent français natif, naturel et fluide]",
  es: "[habla con un acento español nativo, claro y natural]",
  de: "[sprich mit einem natürlichen deutschen Akzent, klar und deutlich]",
  it: "[parla con un accento italiano nativo, naturale e fluido]",
  pt: "[fale com um sotaque português nativo, claro e natural]",
  ja: "[ネイティブな日本語のアクセントで、自然に話してください]",
  ko: "[자연스러운 한국어 억양으로 말해주세요]",
  zh: "[用标准普通话发音，自然流畅地说]",
  ru: "[говори с естественным русским акцентом, чётко и плавно]",
  ar: "[تحدث بلهجة عربية فصحى طبيعية وسلسة]",
  hi: "[प्राकृतिक हिंदी उच्चारण के साथ स्पष्ट और स्वाभाविक बोलें]",
  nl: "[spreek met een natuurlijk Nederlands accent, helder en vloeiend]",
  pl: "[mów z naturalnym polskim akcentem, wyraźnie i płynnie]",
  tr: "[doğal bir Türkçe aksanıyla, net ve akıcı konuş]",
  vi: "[nói với giọng Việt Nam tự nhiên, rõ ràng và trôi chảy]",
  th: "[พูดด้วยสำเนียงไทยที่เป็นธรรมชาติ ชัดเจนและลื่นไหล]",
  id: "[berbicara dengan aksen Indonesia yang alami, jelas dan lancar]",
  sv: "[tala med en naturlig svensk accent, tydligt och flytande]",
  uk: "[говори з природним українським акцентом, чітко і плавно]",
};

/**
 * Fish Audio service — voice cloning and TTS via REST API.
 */
export const fishAudio = {
  /**
   * Create a voice model from a reference audio file.
   * Returns the model ID to use for subsequent TTS calls.
   */
  async createVoiceModel(audioPath: string, title: string): Promise<string> {
    console.log(`[fish-audio] Creating voice model "${title}"...`);

    const form = new FormData();
    const audioBuffer = fs.readFileSync(audioPath);
    const isMP3 = audioPath.endsWith(".mp3");
    const audioBlob = new Blob([audioBuffer], {
      type: isMP3 ? "audio/mpeg" : "audio/wav",
    });
    form.append("voices", audioBlob, isMP3 ? "reference.mp3" : "reference.wav");
    form.append("title", title);
    form.append("type", "tts");
    form.append("train_mode", "fast");
    form.append("visibility", "private");

    const res = await fetch(`${BASE_URL}/model`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.FISH_AUDIO_API_KEY}` },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Fish Audio create model failed (${res.status}): ${text}`,
      );
    }

    const data = await res.json();
    const modelId = data._id ?? data.id;

    if (!modelId) {
      throw new Error("Fish Audio returned no model ID");
    }

    console.log(`[fish-audio] Voice model created: ${modelId}`);
    return modelId;
  },

  /**
   * Generate speech from text using a cloned voice model.
   * Uses S2 Pro for better cross-lingual synthesis and reduced accent bleeding.
   * Returns the audio as a Buffer (WAV format).
   */
  async synthesize(
    text: string,
    referenceId: string,
    targetLanguage?: string,
    prosodySpeed?: number,
  ): Promise<Buffer> {
    // Wrap text with a native-speaker language hint to reduce accent bleeding
    const langHint = targetLanguage
      ? (LANGUAGE_HINTS[targetLanguage] ?? "")
      : "";
    const instructedText = langHint ? `${langHint}\n${text}` : text;

    // Reject empty/whitespace-only text early — Fish Audio returns 0 bytes for these
    if (!text || text.trim().length === 0) {
      throw new Error("Cannot synthesize empty text");
    }

    // Only include prosody when speed differs meaningfully from 1.0
    const speed = prosodySpeed
      ? Math.max(0.5, Math.min(2.0, prosodySpeed))
      : undefined;
    const needsProsody = speed !== undefined && Math.abs(speed - 1.0) > 0.05;

    const requestBody: Record<string, unknown> = {
      text: instructedText,
      reference_id: referenceId,
      format: "wav",
      latency: "normal",
    };
    if (needsProsody) {
      requestBody.prosody = { speed };
    }

    const MAX_RETRIES = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 1s, 2s
        const delay = attempt * 1000;
        console.log(
          `[fish-audio] Retry ${attempt}/${MAX_RETRIES} after ${delay}ms...`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        const res = await fetch(`${BASE_URL}/v1/tts`, {
          method: "POST",
          headers: {
            ...headers("application/json"),
            model: "s2-pro",
          },
          body: JSON.stringify(requestBody),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Fish Audio TTS failed (${res.status}): ${errText}`);
        }

        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Validate the response is actually a WAV file:
        // WAV files start with "RIFF" header and must have reasonable size
        if (buffer.length < 44) {
          const ct = res.headers.get("content-type") ?? "unknown";
          const rl = res.headers.get("retry-after") ?? "none";
          throw new Error(
            `Fish Audio returned too-small response (${buffer.length} bytes, ` +
              `content-type: ${ct}, retry-after: ${rl}, text: "${text.slice(0, 60)}")`,
          );
        }

        const header = buffer.subarray(0, 4).toString("ascii");
        if (header !== "RIFF") {
          // Log what we got instead (likely an error message)
          const preview = buffer.subarray(0, 200).toString("utf-8");
          throw new Error(
            `Fish Audio returned invalid audio (header: "${header}"): ${preview}`,
          );
        }

        return buffer;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(
          `[fish-audio] TTS attempt ${attempt + 1} failed: ${lastError.message}`,
        );
      }
    }

    throw lastError ?? new Error("Fish Audio TTS failed after retries");
  },

  /**
   * Delete a voice model when it's no longer needed.
   */
  async deleteModel(modelId: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/model/${modelId}`, {
      method: "DELETE",
      headers: headers(),
    });

    if (!res.ok) {
      console.warn(
        `[fish-audio] Failed to delete model ${modelId}: ${res.status}`,
      );
    } else {
      console.log(`[fish-audio] Deleted model ${modelId}`);
    }
  },
};
