import { Link, useRouteLoaderData } from "react-router";
import { Video, ChevronRight, Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

export function meta() {
  return [{ title: "Dashboard — Dubly" }];
}

export default function DashboardPage() {
  const layoutData = useRouteLoaderData("routes/platform/layout") as
    | {
        profile: {
          id: string;
          name: string | null;
          email: string;
          role: string;
        };
      }
    | undefined;
  const name =
    layoutData?.profile?.name ?? layoutData?.profile?.email ?? "there";

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

      {/* Stats — will be populated with real data in Phase 3+ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: "TOTAL VIDEOS", value: 0 },
          { label: "COMPLETED", value: 0 },
          { label: "IN PROGRESS", value: 0 },
        ].map((stat) => (
          <Card key={stat.label} className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {stat.label}
            </p>
            <p className="mt-1 text-3xl font-bold">{stat.value}</p>
          </Card>
        ))}
      </div>

      {/* Empty state */}
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
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
        </CardContent>
      </Card>
    </div>
  );
}
