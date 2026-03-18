import { Link, useSearchParams } from "react-router";
import { Video, Loader2, Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { MOCK_TRANSLATIONS, formatDuration, timeAgo } from "~/utils/mock-data";

export function meta() {
  return [{ title: "Translations — Dubly" }];
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "COMPLETED":
      return (
        <Badge className="border-green-500/20 bg-green-500/10 text-green-500">
          Done
        </Badge>
      );
    case "PROCESSING":
      return (
        <Badge className="border-blue-500/20 bg-blue-500/10 text-blue-500">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Translating
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

export default function TranslationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get("status") ?? "all";

  const filtered =
    filter === "all"
      ? MOCK_TRANSLATIONS
      : MOCK_TRANSLATIONS.filter(
          (t) => t.status === filter.toUpperCase(),
        );

  const counts = {
    all: MOCK_TRANSLATIONS.length,
    completed: MOCK_TRANSLATIONS.filter((t) => t.status === "COMPLETED").length,
    processing: MOCK_TRANSLATIONS.filter((t) => t.status === "PROCESSING").length,
    failed: MOCK_TRANSLATIONS.filter((t) => t.status === "FAILED").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Translations</h1>
        <Link to="/platform/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            New Translation
          </Button>
        </Link>
      </div>

      <Tabs
        value={filter}
        onValueChange={(v) => {
          if (v === "all") {
            setSearchParams({});
          } else {
            setSearchParams({ status: v });
          }
        }}
      >
        <TabsList>
          <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
          <TabsTrigger value="completed">
            Completed ({counts.completed})
          </TabsTrigger>
          <TabsTrigger value="processing">
            Processing ({counts.processing})
          </TabsTrigger>
          <TabsTrigger value="failed">Failed ({counts.failed})</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="divide-y divide-border p-0">
          {filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              {filter === "all"
                ? "No translations yet. Create your first one!"
                : `No ${filter} translations.`}
            </div>
          ) : (
            filtered.map((t) => (
              <Link
                key={t.id}
                to={`/platform/translations/${t.id}`}
                className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Video className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.videoTitle}</p>
                    <p className="text-sm text-muted-foreground">
                      &rarr; {t.targetFlag} {t.targetLanguage} &middot;{" "}
                      {formatDuration(t.durationSec)} &middot;{" "}
                      {timeAgo(t.createdAt)}
                    </p>
                  </div>
                </div>
                <StatusBadge status={t.status} />
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="sm" disabled>
          &larr; Previous
        </Button>
        <Button variant="outline" size="sm" className="bg-primary text-primary-foreground">
          1
        </Button>
        <Button variant="outline" size="sm">
          2
        </Button>
        <Button variant="outline" size="sm">
          3
        </Button>
        <Button variant="outline" size="sm">
          Next &rarr;
        </Button>
      </div>
    </div>
  );
}
