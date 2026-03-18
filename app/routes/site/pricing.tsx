import { Check, X } from "lucide-react";
import { Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

export function meta() {
  return [{ title: "Pricing — Dubly" }];
}

const tiers = [
  {
    name: "Free",
    price: "$0",
    description: "Get started with video translation",
    features: [
      { label: "20 translations / month", included: true },
      { label: "100 minutes processed", included: true },
      { label: "50+ languages", included: true },
      { label: "Voice cloning", included: true },
      { label: "Priority processing", included: false },
      { label: "API access", included: false },
    ],
    cta: "Get Started",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$29",
    description: "For professionals and teams",
    features: [
      { label: "Unlimited translations", included: true },
      { label: "Unlimited minutes", included: true },
      { label: "50+ languages", included: true },
      { label: "Voice cloning", included: true },
      { label: "Priority processing", included: true },
      { label: "API access", included: true },
    ],
    cta: "Coming Soon",
    highlighted: true,
  },
];

export default function PricingPage() {
  return (
    <main className="px-6 py-20">
      <div className="mx-auto max-w-4xl text-center">
        <h1 className="text-4xl font-bold">Simple pricing</h1>
        <p className="mt-4 text-muted-foreground">
          Start free. Upgrade when you need more.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
        {tiers.map((tier) => (
          <Card
            key={tier.name}
            className={
              tier.highlighted
                ? "border-primary ring-2 ring-primary/20"
                : ""
            }
          >
            <CardHeader>
              <CardTitle className="text-lg">{tier.name}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {tier.description}
              </p>
              <p className="mt-4 text-4xl font-bold">
                {tier.price}
                <span className="text-sm font-normal text-muted-foreground">
                  /month
                </span>
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {tier.features.map((f) => (
                <div key={f.label} className="flex items-center gap-2 text-sm">
                  {f.included ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <X className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span
                    className={
                      f.included ? "" : "text-muted-foreground"
                    }
                  >
                    {f.label}
                  </span>
                </div>
              ))}
              <Link to="/register" className="mt-6 block">
                <Button
                  className="w-full"
                  variant={tier.highlighted ? "default" : "outline"}
                >
                  {tier.cta}
                </Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
