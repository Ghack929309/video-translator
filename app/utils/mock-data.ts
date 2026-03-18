export const MOCK_PROFILE = {
  id: "usr_001",
  email: "jonathan@example.com",
  name: "Jonathan Calixte",
  role: "USER" as const,
  avatarUrl: null,
  createdAt: new Date("2026-02-01"),
  updatedAt: new Date("2026-03-18"),
};

export type MockTranslation = {
  id: string;
  videoTitle: string;
  targetLanguage: string;
  targetFlag: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  currentStep: string | null;
  progress: number;
  durationSec: number;
  createdAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
  errorStep: string | null;
  retryCount: number;
};

export const MOCK_TRANSLATIONS: MockTranslation[] = [
  {
    id: "tr_001",
    videoTitle: "Product Demo.mp4",
    targetLanguage: "French",
    targetFlag: "\u{1F1EB}\u{1F1F7}",
    status: "COMPLETED",
    currentStep: null,
    progress: 100,
    durationSec: 332,
    createdAt: new Date("2026-03-18T12:00:00"),
    completedAt: new Date("2026-03-18T12:15:00"),
    errorMessage: null,
    errorStep: null,
    retryCount: 0,
  },
  {
    id: "tr_002",
    videoTitle: "Founder Update.mp4",
    targetLanguage: "Spanish",
    targetFlag: "\u{1F1EA}\u{1F1F8}",
    status: "PROCESSING",
    currentStep: "TRANSLATE",
    progress: 47,
    durationSec: 271,
    createdAt: new Date("2026-03-18T10:00:00"),
    completedAt: null,
    errorMessage: null,
    errorStep: null,
    retryCount: 0,
  },
  {
    id: "tr_003",
    videoTitle: "Tutorial Clip.mp4",
    targetLanguage: "German",
    targetFlag: "\u{1F1E9}\u{1F1EA}",
    status: "FAILED",
    currentStep: null,
    progress: 72,
    durationSec: 69,
    createdAt: new Date("2026-03-17T08:00:00"),
    completedAt: null,
    errorMessage: "Fish Audio API returned 429 — rate limit exceeded. Retry attempt 3 of 3.",
    errorStep: "SYNTHESIZE",
    retryCount: 3,
  },
  {
    id: "tr_004",
    videoTitle: "Interview Segment.mp4",
    targetLanguage: "Japanese",
    targetFlag: "\u{1F1EF}\u{1F1F5}",
    status: "COMPLETED",
    currentStep: null,
    progress: 100,
    durationSec: 230,
    createdAt: new Date("2026-03-16T14:00:00"),
    completedAt: new Date("2026-03-16T14:20:00"),
    errorMessage: null,
    errorStep: null,
    retryCount: 0,
  },
  {
    id: "tr_005",
    videoTitle: "Webinar Highlight.mp4",
    targetLanguage: "Italian",
    targetFlag: "\u{1F1EE}\u{1F1F9}",
    status: "PROCESSING",
    currentStep: "MERGE",
    progress: 90,
    durationSec: 102,
    createdAt: new Date("2026-03-15T09:00:00"),
    completedAt: null,
    errorMessage: null,
    errorStep: null,
    retryCount: 0,
  },
  {
    id: "tr_006",
    videoTitle: "Onboarding Tutorial.mp4",
    targetLanguage: "Spanish",
    targetFlag: "\u{1F1EA}\u{1F1F8}",
    status: "PROCESSING",
    currentStep: "SYNTHESIZE",
    progress: 65,
    durationSec: 765,
    createdAt: new Date("2026-03-18T07:00:00"),
    completedAt: null,
    errorMessage: null,
    errorStep: null,
    retryCount: 0,
  },
  {
    id: "tr_007",
    videoTitle: "Marketing Campaign Q1.mp4",
    targetLanguage: "German",
    targetFlag: "\u{1F1E9}\u{1F1EA}",
    status: "COMPLETED",
    currentStep: null,
    progress: 100,
    durationSec: 198,
    createdAt: new Date("2026-03-18T05:00:00"),
    completedAt: new Date("2026-03-18T05:18:00"),
    errorMessage: null,
    errorStep: null,
    retryCount: 0,
  },
  {
    id: "tr_008",
    videoTitle: "CEO Keynote Address.mp4",
    targetLanguage: "Japanese",
    targetFlag: "\u{1F1EF}\u{1F1F5}",
    status: "FAILED",
    currentStep: null,
    progress: 30,
    durationSec: 1330,
    createdAt: new Date("2026-03-17T16:00:00"),
    completedAt: null,
    errorMessage: "Transcription timed out after 30 minutes.",
    errorStep: "TRANSCRIBE",
    retryCount: 2,
  },
];

export const MOCK_TRANSCRIPT_ORIGINAL = [
  { time: "00:00", text: "Welcome to Dubly, your AI video translation workspace." },
  { time: "00:03", text: "Upload a source file and pick your target language." },
  { time: "00:11", text: "We handle transcription, translation, and voice synthesis automatically." },
  { time: "00:17", text: "Your translated output stays frame-accurate and downloadable." },
];

export const MOCK_TRANSCRIPT_TRANSLATED = [
  { time: "00:00", text: "Bienvenue sur Dubly, votre espace de travail de traduction vid\u00e9o IA." },
  { time: "00:03", text: "T\u00e9l\u00e9chargez un fichier source et choisissez votre langue cible." },
  { time: "00:11", text: "Nous g\u00e9rons la transcription, la traduction et la synth\u00e8se vocale automatiquement." },
  { time: "00:17", text: "Votre sortie traduite reste pr\u00e9cise au cadre et t\u00e9l\u00e9chargeable." },
];

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function timeAgo(date: Date): string {
  const now = new Date("2026-03-18T14:45:00");
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins} min ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
