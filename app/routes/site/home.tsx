import { Link } from "react-router";
import {
  ChevronRight,
  Mic,
  Globe,
  Zap,
  Upload,
  FileSearch,
  Languages,
  Download,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

export function meta() {
  return [
    { title: "Dubly — Translate any video, keep the original voice" },
    {
      name: "description",
      content:
        "Upload a video or paste a link. Choose a language. Get back the same video dubbed with voice cloning.",
    },
  ];
}

const features = [
  {
    icon: Mic,
    title: "Voice Cloning",
    description:
      "Preserves the original speaker's voice and tone across languages.",
  },
  {
    icon: Globe,
    title: "50+ Languages",
    description:
      "Translate to any major language with natural-sounding results.",
  },
  {
    icon: Zap,
    title: "Fast Processing",
    description:
      "Upload, wait a few minutes, download your dubbed video.",
  },
];

const steps = [
  { num: 1, icon: Upload, title: "Upload", desc: "Paste a link or drag a file" },
  { num: 2, icon: FileSearch, title: "Transcribe", desc: "AI extracts the transcript" },
  { num: 3, icon: Languages, title: "Translate", desc: "Voice-cloned audio in target" },
  { num: 4, icon: Download, title: "Download", desc: "Same video, new language" },
];

const platforms = ["YouTube", "Instagram", "Facebook", "Vimeo", "Direct Upload"];

export default function HomePage() {
  return (
    <main>
      {/* Hero */}
      <section className="px-6 py-20 text-center md:py-32">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
            Translate any video, keep the{" "}
            <span className="bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
              original voice.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Dubly translates your videos into 50+ languages while preserving tone, style, and
            natural voice with AI.
          </p>
          <Link to="/register" className="mt-8 inline-block">
            <Button size="lg" className="gap-2">
              Get Started — It&apos;s Free
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>

        {/* Product screenshot placeholder */}
        <div className="mx-auto mt-16 max-w-4xl">
          <Card className="border border-border">
            <CardContent className="flex aspect-video items-center justify-center">
              <p className="text-sm text-muted-foreground">
                Product screenshot / demo video
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* How It Works */}
      <section className="border-t border-border px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-12 text-center text-2xl font-semibold">
            How it works
          </h2>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
            {steps.map((step) => (
              <div key={step.num} className="flex flex-col items-center text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground">
                  {step.num}
                </div>
                <step.icon className="mt-4 h-6 w-6 text-muted-foreground" />
                <h3 className="mt-2 font-medium">{step.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-12 text-center text-2xl font-semibold">
            Core features
          </h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {features.map((f) => (
              <Card key={f.title} className="p-6">
                <f.icon className="h-8 w-8 text-primary" />
                <h3 className="mt-4 font-medium">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {f.description}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Supported Platforms */}
      <section className="px-6 py-12">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-8">
          {platforms.map((p) => (
            <span key={p} className="text-sm text-muted-foreground">
              {p}
            </span>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-card px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold">
            Start translating videos today
          </h2>
          <Link to="/register" className="mt-6 inline-block">
            <Button size="lg">Get Started</Button>
          </Link>
          <p className="mt-4 text-xs text-muted-foreground">
            No credit card required
          </p>
        </div>
      </section>
    </main>
  );
}
