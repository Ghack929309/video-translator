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
 * Fish Audio service — voice cloning and TTS via REST API.
 */
export const fishAudio = {
  /**
   * Create a voice model from a reference audio file.
   * Returns the model ID to use for subsequent TTS calls.
   */
  async createVoiceModel(
    audioPath: string,
    title: string,
  ): Promise<string> {
    console.log(`[fish-audio] Creating voice model "${title}"...`);

    const form = new FormData();
    const audioBuffer = fs.readFileSync(audioPath);
    const audioBlob = new Blob([audioBuffer], { type: "audio/wav" });
    form.append("voices", audioBlob, "reference.wav");
    form.append("title", title);
    form.append("visibility", "private");

    const res = await fetch(`${BASE_URL}/model`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.FISH_AUDIO_API_KEY}` },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Fish Audio create model failed (${res.status}): ${text}`);
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
   * Returns the audio as a Buffer (WAV format).
   */
  async synthesize(
    text: string,
    referenceId: string,
  ): Promise<Buffer> {
    const res = await fetch(`${BASE_URL}/v1/tts`, {
      method: "POST",
      headers: headers("application/json"),
      body: JSON.stringify({
        text,
        reference_id: referenceId,
        format: "wav",
        latency: "normal",
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
      console.warn(`[fish-audio] Failed to delete model ${modelId}: ${res.status}`);
    } else {
      console.log(`[fish-audio] Deleted model ${modelId}`);
    }
  },
};
