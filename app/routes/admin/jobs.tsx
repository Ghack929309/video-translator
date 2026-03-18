import { Link, useLoaderData, useSearchParams, data, Form } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  CheckCircle2,
  Loader2,
  Clock,
  AlertCircle,
  RotateCcw,
  ChevronRight,
} from "lucide-react";
import { requireAdmin } from "~/services/middleware/auth";
import { db } from "~/services/db.server";
import { enqueueTranslation } from "~/services/worker.server";
import { languages } from "~/components/language-selector";
import type { Route } from "./+types/jobs";

export function meta() {
  return [{ title: "Jobs — Admin — Dubly" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const headers = new Headers();
  await requireAdmin(request, headers);

  const url = new URL(request.url);
  const filter = url.searchParams.get("status") ?? "all";

  const where =
    filter !== "all"
      ? { status: filter as "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" }
      : {};

  const [jobs, counts] = await Promise.all([
    db.translation.findMany({
      where,
      include: {
        video: {
          select: { title: true, profile: { select: { email: true } } },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    Promise.all([
      db.translation.count(),
      db.translation.count({ where: { status: "PENDING" } }),
      db.translation.count({ where: { status: "PROCESSING" } }),
      db.translation.count({ where: { status: "COMPLETED" } }),
      db.translation.count({ where: { status: "FAILED" } }),
    ]),
  ]);

  return data(
    {
      jobs: jobs.map((j) => ({
        id: j.id,
        videoTitle: j.video.title,
        userEmail: j.video.profile.email,
        targetLanguage: j.targetLanguage,
        status: j.status,
        currentStep: j.currentStep,
        progress: j.progress,
        retryCount: j.retryCount,
        errorMessage: j.errorMessage,
        updatedAt: j.updatedAt.toISOString(),
      })),
      counts: {
        all: counts[0],
        pending: counts[1],
        processing: counts[2],
        completed: counts[3],
        failed: counts[4],
      },
      filter,
    },
    { headers },
  );
}

export async function action({ request }: Route.ActionArgs) {
  const headers = new Headers();
  await requireAdmin(request, headers);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const jobId = formData.get("jobId") as string;

  if (intent === "retry" && jobId) {
    const job = await db.translation.findUnique({ where: { id: jobId } });
    if (job && job.status === "FAILED") {
      await enqueueTranslation(job.id);
    }
  }

  return data({ ok: true }, { headers });
}

const statusIcon: Record<string, { icon: typeof Clock; className: string }> = {
  COMPLETED: { icon: CheckCircle2, className: "text-green-500" },
  PROCESSING: { icon: Loader2, className: "text-blue-500 animate-spin" },
  PENDING: { icon: Clock, className: "text-muted-foreground" },
  FAILED: { icon: AlertCircle, className: "text-destructive" },
};

const filterTabs = [
  { key: "all", label: "All" },
  { key: "PROCESSING", label: "Processing" },
  { key: "PENDING", label: "Pending" },
  { key: "COMPLETED", label: "Completed" },
  { key: "FAILED", label: "Failed" },
] as const;

export default function AdminJobsPage() {
  const { jobs, counts, filter } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Jobs</h1>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {filterTabs.map((tab) => {
          const count =
            tab.key === "all"
              ? counts.all
              : counts[tab.key.toLowerCase() as keyof typeof counts];
          const isActive = filter === tab.key;
          return (
            <Button
              key={tab.key}
              variant={isActive ? "default" : "outline"}
              size="sm"
              onClick={() =>
                setSearchParams(tab.key === "all" ? {} : { status: tab.key })
              }
              className="gap-1.5"
            >
              {tab.label}
              <Badge
                variant="secondary"
                className="ml-1 h-5 min-w-[20px] px-1 text-xs"
              >
                {count}
              </Badge>
            </Button>
          );
        })}
      </div>

      {/* Job list */}
      <Card>
        <CardContent className="p-0">
          {jobs.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No jobs found
            </div>
          ) : (
            <div className="divide-y">
              {jobs.map((job) => {
                const si = statusIcon[job.status] ?? statusIcon.PENDING;
                const Icon = si.icon;
                const lang = languages.find(
                  (l) => l.code === job.targetLanguage,
                );
                return (
                  <div
                    key={job.id}
                    className="flex items-center gap-4 px-4 py-3"
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${si.className}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {job.videoTitle}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {job.userEmail} &middot;{" "}
                        {lang
                          ? `${lang.flag} ${lang.name}`
                          : job.targetLanguage}
                        {job.currentStep &&
                          ` · ${job.currentStep} (${job.progress}%)`}
                        {job.retryCount > 0 && ` · ${job.retryCount} retries`}
                      </p>
                      {job.status === "FAILED" && job.errorMessage && (
                        <p className="mt-0.5 truncate text-xs text-destructive">
                          {job.errorMessage}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {job.status === "FAILED" && (
                        <Form method="post">
                          <input type="hidden" name="intent" value="retry" />
                          <input type="hidden" name="jobId" value={job.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Retry
                          </Button>
                        </Form>
                      )}
                      <Link to={`/platform/translations/${job.id}`}>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
