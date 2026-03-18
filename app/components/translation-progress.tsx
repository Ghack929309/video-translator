import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { Progress } from "~/components/ui/progress";

interface TranslationProgressProps {
  status: string;
  currentStep: string | null;
  progress: number;
  errorMessage: string | null;
  errorStep: string | null;
}

const STEPS = [
  { key: "DOWNLOAD", label: "Download Video" },
  { key: "EXTRACT_AUDIO", label: "Extract Audio" },
  { key: "TRANSCRIBE", label: "Transcribe Speech" },
  { key: "TRANSLATE", label: "Translate Text" },
  { key: "CLONE_VOICE", label: "Clone Voice" },
  { key: "SYNTHESIZE", label: "Synthesize Speech" },
  { key: "MERGE", label: "Merge Video" },
];

function getStepStatus(
  stepKey: string,
  currentStep: string | null,
  translationStatus: string,
  errorStep: string | null,
): "pending" | "active" | "done" | "error" {
  if (translationStatus === "COMPLETED") return "done";
  if (translationStatus === "FAILED" && errorStep === stepKey) return "error";

  const currentIdx = STEPS.findIndex((s) => s.key === currentStep);
  const stepIdx = STEPS.findIndex((s) => s.key === stepKey);

  if (currentIdx < 0) return "pending";
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) {
    if (translationStatus === "FAILED") return "error";
    return "active";
  }
  return "pending";
}

function StepIcon({ status }: { status: "pending" | "active" | "done" | "error" }) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    case "active":
      return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
    case "error":
      return <XCircle className="h-5 w-5 text-destructive" />;
    default:
      return <Circle className="h-5 w-5 text-muted-foreground/40" />;
  }
}

export function TranslationProgress({
  status,
  currentStep,
  progress,
  errorMessage,
  errorStep,
}: TranslationProgressProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            {status === "COMPLETED"
              ? "Translation complete"
              : status === "FAILED"
                ? "Translation failed"
                : "Processing..."}
          </span>
          <span className="text-muted-foreground">{progress}%</span>
        </div>
        <Progress value={progress} />
      </div>

      <div className="space-y-1">
        {STEPS.map((step) => {
          const stepStatus = getStepStatus(step.key, currentStep, status, errorStep);
          return (
            <div
              key={step.key}
              className="flex items-center gap-3 rounded-md px-2 py-1.5"
            >
              <StepIcon status={stepStatus} />
              <span
                className={
                  stepStatus === "active"
                    ? "font-medium text-foreground"
                    : stepStatus === "done"
                      ? "text-muted-foreground"
                      : stepStatus === "error"
                        ? "font-medium text-destructive"
                        : "text-muted-foreground/60"
                }
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {errorMessage && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
