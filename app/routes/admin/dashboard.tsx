import { Card, CardContent } from "~/components/ui/card";
import { Users, ListTodo, AlertTriangle } from "lucide-react";

export function meta() {
  return [{ title: "Admin — Dubly" }];
}

export default function AdminDashboardPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Admin Overview</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: "Total Users", value: 0, icon: Users },
          { label: "Active Jobs", value: 0, icon: ListTodo },
          { label: "Failed Jobs", value: 0, icon: AlertTriangle },
        ].map((stat) => (
          <Card key={stat.label} className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                <stat.icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {stat.label}
                </p>
                <p className="text-2xl font-bold">{stat.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Admin dashboard will show system metrics and recent activity once the pipeline is active.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
