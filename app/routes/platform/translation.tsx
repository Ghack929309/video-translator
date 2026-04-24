import {
  Link,
  useLoaderData,
  data,
  Form,
  redirect,
  useNavigation,
} from "react-router";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Loader2 } from "lucide-react";
import { requireAuth } from "~/services/middleware/auth";
import { db } from "~/services/db.server";
import { Prisma } from "prisma/prisma/client";
import { tigris } from "~/services/tigris.server";
import { enqueueTranslation } from "~/services/worker.server";
import { usePolling } from "~/hooks/use-polling";
import { TranslationProgress } from "~/components/translation-progress";
import { languages } from "~/components/language-selector";
import type { Route } from "./+types/translation";

export function meta() {
  return [{ title: "Translation Detail — Dubly" }];
}

export async function action({ request, params }: Route.ActionArgs) {
  const headers = new Headers();
  const { profile } = await requireAuth(request, headers);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const translation = await db.translation.findUnique({
    where: { id: params.id },
    include: { video: true },
  });

  if (!translation || translation.video.profileId !== profile.id) {
    throw new Response("Not found", { status: 404 });
  }

  if (intent === "retry") {
    if (translation.status !== "FAILED") {
      throw new Response("Can only retry failed translations", { status: 400 });
    }
    await enqueueTranslation(translation.id);
    return data({ ok: true }, { headers });
  }

  if (intent === "reprocess") {
    if (translation.status !== "COMPLETED" && translation.status !== "FAILED") {
      throw new Response("Can only re-process completed or failed translations", { status: 400 });
    }
    await db.translation.update({
      where: { id: translation.id },
      data: {
        status: "PENDING",
        currentStep: null,
        progress: 0,
        errorMessage: null,
        errorStep: null,
        resultVideoKey: null,
        synthesizedAudioKey: null,
        extractedAudioKey: null,
        backgroundAudioKey: null,
        vocalsAudioKey: null,
        transcriptJson: Prisma.DbNull,
        translatedJson: Prisma.DbNull,
        failedSegments: Prisma.DbNull,
        failedSegmentCount: 0,
        startedAt: null,
        completedAt: null,
        retryCount: { increment: 1 },
      },
    });
    await enqueueTranslation(translation.id);
    return data({ ok: true }, { headers });
  }

  if (intent === "delete") {
    await db.translation.delete({ where: { id: translation.id } });
    throw redirect("/platform/translations", { headers });
  }

  throw new Response("Unknown intent", { status: 400 });
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
        transcriptJson: translation.transcriptJson as TranscriptJson | null,
        translatedJson: translation.translatedJson as TranslatedJson | null,
        sourceVideoUrl: translation.video.storageKey
          ? await tigris.presignedDownloadUrl(
              translation.video.storageKey,
              3600,
            )
          : null,
        resultVideoUrl: translation.resultVideoKey
          ? await tigris.presignedDownloadUrl(translation.resultVideoKey, 3600)
          : null,
        failedSegmentCount: translation.failedSegmentCount,
        totalSegmentCount: Array.isArray(translation.translatedJson)
          ? (translation.translatedJson as unknown[]).length
          : 0,
        startedAt: translation.startedAt?.toISOString() ?? null,
        completedAt: translation.completedAt?.toISOString() ?? null,
        createdAt: translation.createdAt.toISOString(),
      },
    },
    { headers },
  );
}

interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

interface TranslatedSegment {
  originalText: string;
  translatedText: string;
  start: number;
  end: number;
}

type TranscriptJson = { segments: TranscriptSegment[] } | null;
type TranslatedJson = TranslatedSegment[] | null;

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
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

  const navigation = useNavigation();
  const isRetrying =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "retry";
  const isReprocessing =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "reprocess";

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

      {/* Failed Segment Warning (per D-13 and UI-SPEC.md) */}
      {translation.failedSegmentCount > 0 && status !== "FAILED" && (
        <div
          role="alert"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />
            <span className="text-sm font-medium text-amber-500">
              Some segments could not be synthesized
            </span>
          </div>
          <p className="mt-1 text-sm text-amber-500/90">
            {translation.failedSegmentCount} of {translation.totalSegmentCount} segments
            failed during voice synthesis and were replaced with silence.
            {status === "COMPLETED" && " The translation is otherwise complete."}
          </p>
        </div>
      )}

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

      {/* Video comparison — shown when result is available */}
      {status === "COMPLETED" && translation.resultVideoUrl && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <p className="text-sm font-medium text-muted-foreground">
                Original
              </p>
            </CardHeader>
            <CardContent>
              {translation.sourceVideoUrl ? (
                <video
                  src={translation.sourceVideoUrl}
                  controls
                  className="aspect-video w-full rounded-md bg-black"
                />
              ) : (
                <div className="flex aspect-video items-center justify-center rounded-md bg-black">
                  <span className="text-sm text-muted-foreground">
                    No source video
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <p className="text-sm font-medium text-muted-foreground">
                Translated ({langLabel})
              </p>
            </CardHeader>
            <CardContent>
              <video
                src={translation.resultVideoUrl}
                controls
                className="aspect-video w-full rounded-md bg-black"
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Transcript — shown when available */}
      {(translation.transcriptJson || translation.translatedJson) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Transcript</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="original">
              <TabsList>
                <TabsTrigger value="original">Original</TabsTrigger>
                {translation.translatedJson && (
                  <TabsTrigger value="translated">Translated</TabsTrigger>
                )}
              </TabsList>
              <TabsContent value="original" className="mt-4 space-y-1">
                {(translation.transcriptJson as TranscriptJson)?.segments.map(
                  (seg, i) => (
                    <div
                      key={i}
                      className="flex gap-4 rounded-md px-2 py-1 leading-relaxed hover:bg-muted/50"
                    >
                      <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                        {formatTimestamp(seg.start)}
                      </span>
                      <span className="text-sm">{seg.text}</span>
                    </div>
                  ),
                )}
              </TabsContent>
              {translation.translatedJson && (
                <TabsContent value="translated" className="mt-4 space-y-1">
                  {(translation.translatedJson as TranslatedJson)?.map(
                    (seg, i) => (
                      <div
                        key={i}
                        className="flex gap-4 rounded-md px-2 py-1 leading-relaxed hover:bg-muted/50"
                      >
                        <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                          {formatTimestamp(seg.start)}
                        </span>
                        <span className="text-sm">{seg.translatedText}</span>
                      </div>
                    ),
                  )}
                </TabsContent>
              )}
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Completed — download + re-process */}
      {status === "COMPLETED" && translation.resultVideoUrl && (
        <div className="flex flex-col gap-3">
          <a
            href={translation.resultVideoUrl}
            download
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="lg" className="w-full gap-2">
              <Download className="h-4 w-4" />
              Download Translated Video
            </Button>
          </a>
          <Form
            method="post"
            onSubmit={(e) => {
              if (
                !confirm("Re-process this translation from scratch? The current result will be replaced.")
              ) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="intent" value="reprocess" />
            <Button
              type="submit"
              size="lg"
              variant="outline"
              className="w-full gap-2"
              disabled={isReprocessing}
            >
              {isReprocessing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Re-process Translation
            </Button>
          </Form>
        </div>
      )}

      {/* Failed — retry / re-process / delete */}
      {status === "FAILED" && (
        <Card className="border-destructive/30">
          <CardContent className="flex gap-3 p-6">
            <Form method="post">
              <input type="hidden" name="intent" value="retry" />
              <Button type="submit" className="gap-2" disabled={isRetrying}>
                {isRetrying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                Retry Translation
              </Button>
            </Form>
            <Form
              method="post"
              onSubmit={(e) => {
                if (
                  !confirm("Re-process from scratch? All existing data will be cleared.")
                ) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="intent" value="reprocess" />
              <Button
                type="submit"
                variant="outline"
                className="gap-2"
                disabled={isReprocessing}
              >
                {isReprocessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                Re-process
              </Button>
            </Form>
            <Form
              method="post"
              onSubmit={(e) => {
                if (
                  !confirm("Delete this translation? This cannot be undone.")
                ) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="intent" value="delete" />
              <Button
                type="submit"
                variant="ghost"
                className="gap-2 text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </Form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
