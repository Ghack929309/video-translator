export const PIPELINE_STEPS = [
  "DOWNLOAD",
  "EXTRACT_AUDIO",
  "TRANSCRIBE",
  "TRANSLATE",
  "CLONE_VOICE",
  "SYNTHESIZE",
  "MERGE",
] as const;

export const PIPELINE_STEP_LABELS: Record<string, string> = {
  DOWNLOAD: "Download",
  EXTRACT_AUDIO: "Extract Audio",
  TRANSCRIBE: "Transcribe",
  TRANSLATE: "Translate",
  CLONE_VOICE: "Clone Voice",
  SYNTHESIZE: "Synthesize",
  MERGE: "Merge",
};

export const MAX_RETRIES = 3;
export const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
export const POLL_INTERVAL_MS = 3000;
export const PRESIGNED_URL_EXPIRY_SECONDS = 3600; // 1 hour
export const MAX_CONCURRENT_JOBS_PER_USER = 5;
export const JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export const SUPPORTED_VIDEO_FORMATS = [
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
] as const;

export const SUPPORTED_VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".webm"] as const;
