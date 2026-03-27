import {
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
} from "react-router";
import { Upload, Link as LinkIcon, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent } from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Separator } from "~/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useState } from "react";
import { UploadZone } from "~/components/upload-zone";
import { UrlInput } from "~/components/url-input";
import { LanguageSelector } from "~/components/language-selector";
import { useUpload } from "~/hooks/use-upload";
import { requireAuth } from "~/services/middleware/auth";
import { db } from "~/services/db.server";
import { videoSubmitSchema } from "~/utils/validation";
import { enqueueTranslation } from "~/services/worker.server";
import type { Route } from "./+types/new-translation";

export function meta() {
  return [{ title: "New Translation — Dubly" }];
}

export async function action({ request }: Route.ActionArgs) {
  const headers = new Headers();
  const { profile } = await requireAuth(request, headers);
  const formData = await request.formData();
  const raw = Object.fromEntries(formData);
  const parsed = videoSubmitSchema.safeParse(raw);

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const firstError =
      fieldErrors.title?.[0] ??
      fieldErrors.targetLanguage?.[0] ??
      fieldErrors.sourceType?.[0] ??
      "Invalid input";
    return { error: firstError };
  }

  const { sourceType, sourceUrl, storageKey, title, targetLanguage, ttsEngine } =
    parsed.data;

  // Rate limit: max 5 concurrent (PENDING or PROCESSING) jobs per user
  const activeJobs = await db.translation.count({
    where: {
      video: { profileId: profile.id },
      status: { in: ["PENDING", "PROCESSING"] },
    },
  });
  if (activeJobs >= 5) {
    return {
      error:
        "You have too many translations in progress (max 5). Please wait for some to finish.",
    };
  }

  // For URL-based sources, storageKey will be set during the DOWNLOAD pipeline step
  const video = await db.video.create({
    data: {
      profileId: profile.id,
      title,
      sourceType,
      sourceUrl: sourceUrl ?? null,
      storageKey: storageKey ?? "",
    },
  });

  const translation = await db.translation.create({
    data: {
      videoId: video.id,
      targetLanguage,
      ttsEngine,
    },
  });

  // Enqueue the translation processing job
  await enqueueTranslation(translation.id);

  throw redirect(`/platform/translations/${translation.id}`, { headers });
}

export default function NewTranslationPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [tab, setTab] = useState<string>("upload");
  const [selectedLang, setSelectedLang] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [detectedPlatform, setDetectedPlatform] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [engine, setEngine] = useState<"FISH_AUDIO" | "COSYVOICE" | null>(null);

  const upload = useUpload();

  // If engine changes, validate selected language
  const handleEngineChange = (newEngine: "FISH_AUDIO" | "COSYVOICE") => {
    setEngine(newEngine);
    if (newEngine === "COSYVOICE" && selectedLang) {
      const COSYVOICE_SUPPORTED = ["en", "zh", "ja", "ko", "de", "es", "fr", "it", "ru"];
      if (!COSYVOICE_SUPPORTED.includes(selectedLang)) {
        setSelectedLang(null);
      }
    }
  };

  const canSubmitUpload = upload.status === "done" && selectedLang && engine;
  const canSubmitUrl = videoUrl.trim() && detectedPlatform && selectedLang && engine;
  const canSubmit = tab === "upload" ? canSubmitUpload : canSubmitUrl;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New Translation</h1>
        <p className="text-sm text-muted-foreground">
          Translate a video into another language
        </p>
      </div>

      {actionData?.error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionData.error}
        </div>
      )}

      <Card>
        <CardContent className="space-y-6 p-6">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="upload" className="gap-2">
                <Upload className="h-4 w-4" />
                Upload File
              </TabsTrigger>
              <TabsTrigger value="link" className="gap-2">
                <LinkIcon className="h-4 w-4" />
                Paste Link
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="mt-4">
              <UploadZone
                status={upload.status}
                progress={upload.progress}
                fileName={upload.fileName}
                fileSize={upload.fileSize}
                error={upload.error}
                onFileSelect={upload.upload}
                onReset={upload.reset}
              />
            </TabsContent>

            <TabsContent value="link" className="mt-4">
              <UrlInput
                value={videoUrl}
                onChange={(url, platform) => {
                  setVideoUrl(url);
                  setDetectedPlatform(platform);
                }}
              />
            </TabsContent>
          </Tabs>

          <Separator />

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>TTS Engine</Label>
              <Select
                value={engine ?? ""}
                onValueChange={(val) => handleEngineChange(val as "FISH_AUDIO" | "COSYVOICE")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a synthesis engine..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="COSYVOICE">
                    <div className="flex flex-col">
                      <span>CosyVoice 3 (GPU)</span>
                      <span className="text-xs text-muted-foreground mt-0.5">High-quality voice cloning (9 languages)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="FISH_AUDIO">
                    <div className="flex flex-col">
                      <span>Fish Audio</span>
                      <span className="text-xs text-muted-foreground mt-0.5">Versatile generation (12+ languages)</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Select the voice synthesis engine. Note: Supported target languages change based on the engine.
              </p>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Target Language</Label>
              <LanguageSelector value={selectedLang} onChange={setSelectedLang} engine={engine} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Video Title</Label>
              <Input
                id="title"
                name="title"
                placeholder="My Product Demo"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>

          <Form method="post">
            {/* Hidden fields for form submission */}
            <input
              type="hidden"
              name="title"
              value={title || (upload.fileName ?? "Untitled Video")}
            />
            <input
              type="hidden"
              name="targetLanguage"
              value={selectedLang ?? ""}
            />
            <input
              type="hidden"
              name="ttsEngine"
              value={engine ?? ""}
            />
            {tab === "upload" ? (
              <>
                <input type="hidden" name="sourceType" value="UPLOAD" />
                <input
                  type="hidden"
                  name="storageKey"
                  value={upload.storageKey ?? ""}
                />
              </>
            ) : (
              <>
                <input
                  type="hidden"
                  name="sourceType"
                  value={detectedPlatform ?? ""}
                />
                <input type="hidden" name="sourceUrl" value={videoUrl} />
              </>
            )}

            <div className="flex justify-end gap-3">
              <Link to="/platform">
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                disabled={!canSubmit || isSubmitting}
                className="gap-2"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Start Translation
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
