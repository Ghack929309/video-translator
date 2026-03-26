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

    // Clamp prosody speed to Fish Audio's reasonable range (0.5–2.0)
    const speed = prosodySpeed ? Math.max(0.5, Math.min(2.0, prosodySpeed)) : 1;

    const res = await fetch(`${BASE_URL}/v1/tts`, {
      method: "POST",
      headers: {
        ...headers("application/json"),
        model: "s2-pro",
      },
      body: JSON.stringify({
        text: instructedText,
        reference_id: referenceId,
        format: "wav",
        latency: "normal",
        prosody: { speed, volume: 0 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Fish Audio TTS failed (${res.status}): ${errText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
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
