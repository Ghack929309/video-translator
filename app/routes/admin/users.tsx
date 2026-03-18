import { useLoaderData, data } from "react-router";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { requireAdmin } from "~/services/middleware/auth";
import { db } from "~/services/db.server";
import type { Route } from "./+types/users";

export function meta() {
  return [{ title: "Users — Admin — Dubly" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const headers = new Headers();
  await requireAdmin(request, headers);

  const users = await db.profile.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { videos: true } },
    },
  });

  // Get translation counts per user
  const userStats = await Promise.all(
    users.map(async (u) => {
      const [total, completed, processing] = await Promise.all([
        db.translation.count({ where: { video: { profileId: u.id } } }),
        db.translation.count({
          where: { video: { profileId: u.id }, status: "COMPLETED" },
        }),
        db.translation.count({
          where: { video: { profileId: u.id }, status: "PROCESSING" },
        }),
      ]);
      return { userId: u.id, total, completed, processing };
    }),
  );

  return data(
    {
      users: users.map((u) => {
        const stats = userStats.find((s) => s.userId === u.id);
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          videoCount: u._count.videos,
          translationCount: stats?.total ?? 0,
          completedCount: stats?.completed ?? 0,
          processingCount: stats?.processing ?? 0,
          createdAt: u.createdAt.toISOString(),
        };
      }),
    },
    { headers },
  );
}

export default function AdminUsersPage() {
  const { users } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <Badge variant="secondary">{users.length} total</Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          {users.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No users found
            </div>
          ) : (
            <div className="divide-y">
              {users.map((user) => {
                const initials = (user.name ?? user.email)
                  .split(" ")
                  .map((n: string) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2);
                return (
                  <div
                    key={user.id}
                    className="flex items-center gap-4 px-4 py-3"
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {user.name ?? user.email}
                        </p>
                        {user.role === "ADMIN" && (
                          <Badge
                            variant="secondary"
                            className="bg-primary/10 text-primary text-xs"
                          >
                            Admin
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>
                        {user.translationCount} translations
                        {user.processingCount > 0 &&
                          ` (${user.processingCount} active)`}
                      </p>
                      <p>{user.completedCount} completed</p>
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
