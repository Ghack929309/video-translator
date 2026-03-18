import { Link, useLoaderData, data } from "react-router";
import {
  ArrowLeft,
  Check,
  Download,
  RotateCcw,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { requireAuth } from "~/services/middleware/auth";
import { db } from "~/services/db.server";
import { usePolling } from "~/hooks/use-polling";
import { TranslationProgress } from "~/components/translation-progress";
import { languages } from "~/components/language-selector";
import type { Route } from "./+types/translation";

export function meta() {
  return [{ title: "Translation Detail — Dubly" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const headers = new Headers();
  const { profile } = await requireAuth(request, headers);

  const translation = await db.translation.findUnique({
    where: { id: params.id },
    include: { video: true },
  });

  if (!translation || translation.video.profileId !== profile.id) {
    throw new Response("Not found", { status: 404 });
  }

  return data(
    {
      translation: {
        id: translation.id,
        videoTitle: translation.video.title,
        targetLanguage: translation.targetLanguage,
        status: translation.status,
        currentStep: translation.currentStep,
        progress: translation.progress,
        errorMessage: translation.errorMessage,
        errorStep: translation.errorStep,
        resultVideoKey: translation.resultVideoKey,
        startedAt: translation.startedAt?.toISOString() ?? null,
        completedAt: translation.completedAt?.toISOString() ?? null,
        createdAt: translation.createdAt.toISOString(),
      },
    },
    { headers },
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
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

export default function TranslationDetailPage() {
  const { translation } = useLoaderData<typeof loader>();

  const lang = languages.find((l) => l.code === translation.targetLanguage);
  const langLabel = lang
    ? `${lang.flag} ${lang.name}`
    : translation.targetLanguage;

  // Poll for live status updates while processing
  const isProcessing =
    translation.status === "PENDING" || translation.status === "PROCESSING";
  const { data: liveStatus } = usePolling({
    translationId: translation.id,
    enabled: isProcessing,
  });

  // Use live status if available, otherwise fall back to loader data
  const status = liveStatus?.status ?? translation.status;
  const currentStep = liveStatus?.currentStep ?? translation.currentStep;
  const progress = liveStatus?.progress ?? translation.progress;
  const errorMessage = liveStatus?.errorMessage ?? translation.errorMessage;
  const errorStep = liveStatus?.errorStep ?? translation.errorStep;

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
            {translation.videoTitle} &rarr; {langLabel}
          </h1>
          <p className="text-sm text-muted-foreground">
            {status === "COMPLETED" && translation.completedAt
              ? `Completed ${timeAgo(translation.completedAt)}`
              : status === "PROCESSING" && translation.startedAt
                ? `Started ${timeAgo(translation.startedAt)}`
                : `Created ${timeAgo(translation.createdAt)}`}
          </p>
          {status === "COMPLETED" && (
            <p className="mt-1 flex items-center gap-1 text-sm text-green-500">
              <Check className="h-4 w-4" />
              Translation complete
            </p>
          )}
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Progress card — shown for processing, pending, completed, and failed */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pipeline Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <TranslationProgress
            status={status}
            currentStep={currentStep}
            progress={progress}
            errorMessage={errorMessage}
            errorStep={errorStep}
          />
        </CardContent>
      </Card>

      {/* Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Translation Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Source</dt>
              <dd className="font-medium">{translation.videoTitle}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Target Language</dt>
              <dd className="font-medium">{langLabel}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium capitalize">{status.toLowerCase()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Created</dt>
              <dd className="font-medium">
                {new Date(translation.createdAt).toLocaleString()}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Completed — download button */}
      {status === "COMPLETED" && (
        <Button size="lg" className="w-full gap-2">
          <Download className="h-4 w-4" />
          Download Translated Video
        </Button>
      )}

      {/* Failed — retry / delete */}
      {status === "FAILED" && (
        <Card className="border-destructive/30">
          <CardContent className="flex gap-3 p-6">
            <Button className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Retry Translation
            </Button>
            <Button variant="ghost" className="gap-2 text-destructive">
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
