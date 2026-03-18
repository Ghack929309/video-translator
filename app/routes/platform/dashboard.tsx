import { Link } from "react-router";
import { Video, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import {
  MOCK_TRANSLATIONS,
  MOCK_PROFILE,
  formatDuration,
  timeAgo,
} from "~/utils/mock-data";

export function meta() {
  return [{ title: "Dashboard — Dubly" }];
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
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
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
      return (
        <Badge variant="secondary">Pending</Badge>
      );
  }
}

export default function DashboardPage() {
  const totalVideos = MOCK_TRANSLATIONS.length;
  const completed = MOCK_TRANSLATIONS.filter((t) => t.status === "COMPLETED").length;
  const inProgress = MOCK_TRANSLATIONS.filter((t) => t.status === "PROCESSING").length;
  const recent = MOCK_TRANSLATIONS.slice(0, 5);

  const stats = [
    { label: "TOTAL VIDEOS", value: totalVideos, trend: "+3 this week" },
    { label: "COMPLETED", value: completed, trend: "+3 this week" },
    { label: "IN PROGRESS", value: inProgress, trend: "+3 this week" },
  ];

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">
        Welcome back, {MOCK_PROFILE.name.split(" ")[0]}
      </h1>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {stat.label}
            </p>
            <p className="mt-1 text-3xl font-bold">{stat.value}</p>
            <p className="mt-1 text-xs text-green-500">{stat.trend}</p>
          </Card>
        ))}
      </div>

      {/* Recent Translations */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium">Recent Translations</h2>
          <Link
            to="/platform/translations"
            className="flex items-center gap-1 text-sm text-primary hover:underline"
          >
            View all <ChevronRight className="h-3 w-3" />
          </Link>
        </div>

        <Card>
          <CardContent className="divide-y divide-border p-0">
            {recent.map((t) => (
              <Link
                key={t.id}
                to={`/platform/translations/${t.id}`}
                className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                    <Video className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium">{t.videoTitle}</p>
                    <p className="text-sm text-muted-foreground">
                      {t.targetFlag} {t.targetLanguage} &middot;{" "}
                      {formatDuration(t.durationSec)} &middot;{" "}
                      {timeAgo(t.createdAt)}
                    </p>
                  </div>
                </div>
                <StatusBadge status={t.status} />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
