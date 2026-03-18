import { z } from "zod";

const envSchema = z.object({
  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Database
  DATABASE_URL: z.string().min(1),
  DIRECT_DATABASE_URL: z.string().min(1),

  // Tigris (S3-compatible)
  TIGRIS_ACCESS_KEY_ID: z.string().min(1),
  TIGRIS_SECRET_ACCESS_KEY: z.string().min(1),
  TIGRIS_ENDPOINT_URL: z.string().url(),
  TIGRIS_BUCKET_NAME: z.string().min(1),
  TIGRIS_REGION: z.string().default("auto"),

  // AssemblyAI
  ASSEMBLYAI_API_KEY: z.string().min(1),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1),

  // Fish Audio
  FISH_AUDIO_API_KEY: z.string().min(1),

  // App
  APP_URL: z.string().url(),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.flatten().fieldErrors;
    const missing = Object.entries(formatted)
      .map(([key, errors]) => `  ${key}: ${errors?.join(", ")}`)
      .join("\n");

    throw new Error(
      `Missing or invalid environment variables:\n${missing}\n\nCheck your .env file against .env.example.`,
    );
  }

  return result.data;
}

export const env = validateEnv();
