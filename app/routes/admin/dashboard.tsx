import { useFetcher } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { runpodApi } from "~/services/runpod-api.server";
import { env } from "~/utils/env.server";
import { useEffect } from "react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Users, ListTodo, AlertTriangle, Server, PowerOff, Activity } from "lucide-react";

export function meta() {
  return [{ title: "Admin — Dubly" }];
}

export async function loader({ request }: LoaderFunctionArgs) {
  let runpodStatus = null;
  if (env.RUNPOD_ENDPOINT_ID) {
    try {
      runpodStatus = await runpodApi.getEndpointStatus(env.RUNPOD_ENDPOINT_ID);
    } catch (e) {
      console.error("Failed to fetch RunPod status", e);
    }
  }
  return { runpodStatus };
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "shutdown_runpod" && env.RUNPOD_ENDPOINT_ID) {
    await runpodApi.scaleMinWorkers(env.RUNPOD_ENDPOINT_ID, 0);
    return { success: true };
  }
  return { success: false };
}

export default function AdminDashboardPage({ loaderData }: any) {
  const fetcher = useFetcher<typeof loader>();
  
  // Use loaderData on first paint, fallback to fetcher data on polling updates
  const initialData = loaderData?.runpodStatus;
  const currentStatus = fetcher.data?.runpodStatus !== undefined 
    ? fetcher.data.runpodStatus 
    : initialData;

  // Poll exactly every 10 seconds to keep the widget live
  useEffect(() => {
    const interval = setInterval(() => {
      // Reload this route's loaders
      if (fetcher.state === "idle") {
        fetcher.load("/admin");
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [fetcher]);

  // Derive Badge variant
  let badgeLabel = "Asleep";
  let badgeVariant: "default" | "secondary" | "destructive" | "outline" = "outline";

  if (currentStatus) {
    const active = currentStatus.workers?.filter((w: any) => w.status === "RUNNING").length || 0;
    if (active > 0) {
      badgeLabel = "Online";
      badgeVariant = "default";
    } else if (currentStatus.workersMin > 0) {
      badgeLabel = "Scaling Up...";
      badgeVariant = "secondary";
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Admin Overview</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
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

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* RunPod Status Widget */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" /> 
                CosyVoice API Server
              </CardTitle>
              <CardDescription>RunPod Serverless V2 Endpoint</CardDescription>
            </div>
            {currentStatus && (
              <Badge variant={badgeVariant} className="px-3 py-1 text-sm font-medium">
                {badgeLabel === "Online" && <Activity className="mr-1 h-3 w-3 inline animate-pulse" />}
                {badgeLabel}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {currentStatus ? (
              <>
                 <div className="grid grid-cols-2 text-sm gap-2">
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">Configured Min/Max</span>
                      <span className="font-medium">{currentStatus.workersMin} / {currentStatus.workersMax}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">Running Pods</span>
                      <span className="font-medium">{currentStatus.workers?.filter((w: any) => w.status === "RUNNING").length || 0}</span>
                    </div>
                 </div>

                 <fetcher.Form method="post" className="pt-2">
                   <input type="hidden" name="intent" value="shutdown_runpod" />
                   <Button 
                     variant="destructive" 
                     className="w-full"
                     disabled={currentStatus.workersMax === 0}
                     type="submit"
                   >
                     <PowerOff className="mr-2 h-4 w-4" />
                     Force Shutdown
                   </Button>
                 </fetcher.Form>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                RunPod Endpoint ID is not configured or unreachable via GraphQL.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
