import { Link, useSearchParams, useLoaderData, data } from "react-router";
import { Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { TranslationCard } from "~/components/translation-card";
import { requireAuth } from "~/services/middleware/auth";
import { db } from "~/services/db.server";
import type { Route } from "./+types/translations";

export function meta() {
  return [{ title: "Translations — Dubly" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const headers = new Headers();
  const { profile } = await requireAuth(request, headers);

  const translations = await db.translation.findMany({
    where: { video: { profileId: profile.id } },
    orderBy: { createdAt: "desc" },
    include: { video: { select: { title: true } } },
  });

  const items = translations.map((t) => ({
    id: t.id,
    videoTitle: t.video.title,
    targetLanguage: t.targetLanguage,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
  }));

  return data({ translations: items }, { headers });
}

export default function TranslationsPage() {
  const { translations } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get("status") ?? "all";

  const filtered =
    filter === "all"
      ? translations
      : translations.filter((t) => t.status === filter.toUpperCase());

  const counts = {
    all: translations.length,
    completed: translations.filter((t) => t.status === "COMPLETED").length,
    processing: translations.filter((t) => t.status === "PROCESSING").length,
    failed: translations.filter((t) => t.status === "FAILED").length,
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
              <TranslationCard
                key={t.id}
                id={t.id}
                videoTitle={t.videoTitle}
                targetLanguage={t.targetLanguage}
                status={t.status}
                createdAt={t.createdAt}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
