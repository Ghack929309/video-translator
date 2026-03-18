import { Card, CardContent } from "~/components/ui/card";
import { Users } from "lucide-react";

export function meta() {
  return [{ title: "Users — Admin — Dubly" }];
}

export default function AdminUsersPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Users</h1>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Users className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-lg font-medium">User management</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            User list and management will be available in Phase 7.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
