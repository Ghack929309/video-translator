import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";

export function meta() {
  return [{ title: "Billing — Dubly" }];
}

export default function BillingPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Billing &amp; Usage</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Current Plan: <span className="text-primary">Free</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Translations this month</span>
              <span className="font-medium">12 / 20</span>
            </div>
            <Progress value={60} className="h-2" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Minutes processed</span>
              <span className="font-medium">47 / 100</span>
            </div>
            <Progress value={47} className="h-2" />
          </div>

          <p className="text-sm text-muted-foreground">
            Resets on April 1, 2026
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
