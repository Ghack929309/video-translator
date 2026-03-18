import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  Check,
  Loader2,
  Circle,
  Download,
  RotateCcw,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Progress } from "~/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Separator } from "~/components/ui/separator";
import {
  MOCK_TRANSLATIONS,
  MOCK_TRANSCRIPT_ORIGINAL,
  MOCK_TRANSCRIPT_TRANSLATED,
  formatDuration,
  timeAgo,
} from "~/utils/mock-data";
import { PIPELINE_STEPS, PIPELINE_STEP_LABELS } from "~/utils/constants";

export function meta() {
  return [{ title: "Translation Detail — Dubly" }];
}

function StepIndicator({
  step,
  status,
}: {
  step: string;
  status: "completed" | "current" | "pending";
}) {
  return (
    <div className="flex items-center gap-2">
      {status === "completed" ? (
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500">
          <Check className="h-3 w-3 text-white" />
        </div>
      ) : status === "current" ? (
        <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
      ) : (
        <Circle className="h-5 w-5 text-muted-foreground" />
      )}
      <span
        className={`text-sm ${
          status === "pending" ? "text-muted-foreground" : ""
        }`}
      >
        {PIPELINE_STEP_LABELS[step] ?? step}
      </span>
    </div>
  );
}

function ProcessingView({ translation }: { translation: (typeof MOCK_TRANSLATIONS)[0] }) {
  const currentIdx = PIPELINE_STEPS.indexOf(
    translation.currentStep as (typeof PIPELINE_STEPS)[number],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pipeline Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PIPELINE_STEPS.map((step, i) => (
              <StepIndicator
                key={step}
                step={step}
                status={
                  i < currentIdx
                    ? "completed"
                    : i === currentIdx
                      ? "current"
                      : "pending"
                }
              />
            ))}
          </div>

          <Progress
            value={translation.progress}
            className="h-2 transition-all duration-500 ease-out"
          />
          <p className="animate-pulse text-sm text-muted-foreground">
            Step {currentIdx + 1} of {PIPELINE_STEPS.length} &mdash;{" "}
            {PIPELINE_STEP_LABELS[PIPELINE_STEPS[currentIdx]]}...{" "}
            {translation.progress}%
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Translation Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            {[
              ["Source", translation.videoTitle],
              ["Duration", formatDuration(translation.durationSec)],
              ["Target", `${translation.targetFlag} ${translation.targetLanguage}`],
              ["Status", "Processing"],
              ["Created", "March 18, 2026 at 2:45 PM"],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function CompletedView({ translation }: { translation: (typeof MOCK_TRANSLATIONS)[0] }) {
  return (
    <div className="space-y-6">
      {/* Video comparison */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <p className="text-sm font-medium text-muted-foreground">
              Original
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex aspect-video items-center justify-center rounded-md bg-black">
              <span className="text-sm text-muted-foreground">
                Video Player
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <p className="text-sm font-medium text-muted-foreground">
              Translated ({translation.targetLanguage}) {translation.targetFlag}
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex aspect-video items-center justify-center rounded-md bg-black">
              <span className="text-sm text-muted-foreground">
                Video Player
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Button size="lg" className="w-full gap-2">
        <Download className="h-4 w-4" />
        Download Translated Video
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        MP4 &middot; 24.3 MB
      </p>

      {/* Transcript */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="original">
            <TabsList>
              <TabsTrigger value="original">Original</TabsTrigger>
              <TabsTrigger value="translated">Translated</TabsTrigger>
            </TabsList>
            <TabsContent value="original" className="mt-4 space-y-2">
              {MOCK_TRANSCRIPT_ORIGINAL.map((line) => (
                <div
                  key={line.time}
                  className="flex gap-4 rounded-md px-2 py-1 leading-relaxed hover:bg-muted/50"
                >
                  <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                    [{line.time}]
                  </span>
                  <span className="text-sm">{line.text}</span>
                </div>
              ))}
            </TabsContent>
            <TabsContent value="translated" className="mt-4 space-y-2">
              {MOCK_TRANSCRIPT_TRANSLATED.map((line) => (
                <div
                  key={line.time}
                  className="flex gap-4 rounded-md px-2 py-1 leading-relaxed hover:bg-muted/50"
                >
                  <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                    [{line.time}]
                  </span>
                  <span className="text-sm">{line.text}</span>
                </div>
              ))}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function FailedView({ translation }: { translation: (typeof MOCK_TRANSLATIONS)[0] }) {
  return (
    <Card className="border-destructive/30">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          <h3 className="font-medium">Translation failed</h3>
        </div>
        <div className="space-y-1 text-sm">
          <p>
            <span className="text-muted-foreground">Step:</span>{" "}
            {translation.errorStep
              ? PIPELINE_STEP_LABELS[translation.errorStep]
              : "Unknown"}{" "}
            (step{" "}
            {translation.errorStep
              ? PIPELINE_STEPS.indexOf(
                  translation.errorStep as (typeof PIPELINE_STEPS)[number],
                ) + 1
              : "?"}{" "}
            of {PIPELINE_STEPS.length})
          </p>
          <p>
            <span className="text-muted-foreground">Error:</span>{" "}
            {translation.errorMessage}
          </p>
        </div>
        <div className="flex gap-3">
          <Button className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Retry Translation
          </Button>
          <Button variant="ghost" className="gap-2 text-destructive">
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TranslationDetailPage() {
  const { id } = useParams();
  const translation =
    MOCK_TRANSLATIONS.find((t) => t.id === id) ?? MOCK_TRANSLATIONS[0];

  function StatusBadge() {
    switch (translation.status) {
      case "COMPLETED":
        return (
          <Badge className="border-green-500/20 bg-green-500/10 text-green-500">
            Completed
          </Badge>
        );
      case "PROCESSING":
        return (
          <Badge className="border-blue-500/20 bg-blue-500/10 text-blue-500">
            Processing
          </Badge>
        );
      case "FAILED":
        return (
          <Badge className="border-destructive/20 bg-destructive/10 text-destructive">
            Failed
          </Badge>
        );
      default:
        return <Badge variant="secondary">Pending</Badge>;
    }
  }

  return (
    <div className="space-y-6">
      <Link
        to="/platform/translations"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to translations
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {translation.videoTitle} &rarr; {translation.targetLanguage}
          </h1>
          <p className="text-sm text-muted-foreground">
            {translation.status === "COMPLETED"
              ? `Completed ${timeAgo(translation.completedAt!)}`
              : translation.status === "PROCESSING"
                ? `Started ${timeAgo(translation.createdAt)}`
                : `Created ${timeAgo(translation.createdAt)}`}
          </p>
          {translation.status === "COMPLETED" && (
            <p className="mt-1 flex items-center gap-1 text-sm text-green-500">
              <Check className="h-4 w-4" />
              All 7 steps completed
            </p>
          )}
        </div>
        <StatusBadge />
      </div>

      {translation.status === "PROCESSING" && (
        <ProcessingView translation={translation} />
      )}
      {translation.status === "COMPLETED" && (
        <CompletedView translation={translation} />
      )}
      {translation.status === "FAILED" && (
        <FailedView translation={translation} />
      )}
    </div>
  );
}
