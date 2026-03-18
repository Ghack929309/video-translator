import { Link, useLoaderData, data } from "react-router";
import {
  Video,
  Plus,
  Clock,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { requireAuth } from "~/services/middleware/auth";
import { db } from "~/services/db.server";
import { languages } from "~/components/language-selector";
import type { Route } from "./+types/dashboard";

export function meta() {
  return [{ title: "Dashboard — Dubly" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const headers = new Headers();
  const { profile } = await requireAuth(request, headers);

  const [total, completed, processing, failed, recent] = await Promise.all([
    db.translation.count({ where: { video: { profileId: profile.id } } }),
    db.translation.count({
      where: { video: { profileId: profile.id }, status: "COMPLETED" },
    }),
    db.translation.count({
      where: { video: { profileId: profile.id }, status: "PROCESSING" },
    }),
    db.translation.count({
      where: { video: { profileId: profile.id }, status: "FAILED" },
    }),
    db.translation.findMany({
      where: { video: { profileId: profile.id } },
      include: { video: { select: { title: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  return data(
    {
      profile: { name: profile.name, email: profile.email },
      stats: { total, completed, processing, failed },
      recent: recent.map((t) => ({
        id: t.id,
        videoTitle: t.video.title,
        targetLanguage: t.targetLanguage,
        status: t.status,
        progress: t.progress,
        createdAt: t.createdAt.toISOString(),
      })),
    },
    { headers },
  );
}

const statusConfig: Record<
  string,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  COMPLETED: {
    label: "Completed",
    icon: CheckCircle2,
    className: "text-green-500",
  },
  PROCESSING: {
    label: "Processing",
    icon: Loader2,
    className: "text-blue-500 animate-spin",
  },
  PENDING: {
    label: "Pending",
    icon: Clock,
    className: "text-muted-foreground",
  },
  FAILED: { label: "Failed", icon: AlertCircle, className: "text-destructive" },
};

export default function DashboardPage() {
  const { profile, stats, recent } = useLoaderData<typeof loader>();
  const name = profile.name ?? profile.email ?? "there";

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Welcome back, {name.split(" ")[0]}
        </h1>
        <Link to="/platform/new">
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            New Translation
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total", value: stats.total },
          { label: "Completed", value: stats.completed },
          { label: "In Progress", value: stats.processing },
          { label: "Failed", value: stats.failed },
        ].map((stat) => (
          <Card key={stat.label} className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {stat.label}
            </p>
            <p className="mt-1 text-3xl font-bold">{stat.value}</p>
          </Card>
        ))}
      </div>

      {/* Recent translations */}
      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg">Recent Translations</CardTitle>
          {stats.total > 0 && (
            <Link
              to="/platform/translations"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              View all <ChevronRight className="ml-0.5 inline h-3 w-3" />
            </Link>
          )}
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Video className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mt-4 text-lg font-medium">No translations yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload a video or paste a URL to get started
              </p>
              <Link to="/platform/new" className="mt-4">
                <Button size="sm" className="gap-2">
                  <Plus className="h-4 w-4" />
                  New Translation
                </Button>
              </Link>
            </div>
          ) : (
            <div className="divide-y">
              {recent.map((t) => {
                const sc = statusConfig[t.status] ?? statusConfig.PENDING;
                const Icon = sc.icon;
                const lang = languages.find((l) => l.code === t.targetLanguage);
                return (
                  <Link
                    key={t.id}
                    to={`/platform/translations/${t.id}`}
                    className="flex items-center gap-4 py-3 transition-colors hover:bg-muted/50 rounded-md px-2 -mx-2"
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${sc.className}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {t.videoTitle}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {lang ? `${lang.flag} ${lang.name}` : t.targetLanguage}{" "}
                        &middot; {sc.label}
                        {t.status === "PROCESSING" && ` (${t.progress}%)`}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
