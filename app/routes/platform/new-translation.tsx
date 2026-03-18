import { Link } from "react-router";
import { Upload, Link as LinkIcon, ChevronRight, Check } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { Separator } from "~/components/ui/separator";
import { useState } from "react";

export function meta() {
  return [{ title: "New Translation — Dubly" }];
}

const popularLanguages = [
  { code: "en", flag: "\u{1F1FA}\u{1F1F8}", name: "English" },
  { code: "es", flag: "\u{1F1EA}\u{1F1F8}", name: "Spanish" },
  { code: "fr", flag: "\u{1F1EB}\u{1F1F7}", name: "French" },
  { code: "de", flag: "\u{1F1E9}\u{1F1EA}", name: "German" },
  { code: "pt", flag: "\u{1F1E7}\u{1F1F7}", name: "Portuguese" },
  { code: "zh", flag: "\u{1F1E8}\u{1F1F3}", name: "Chinese" },
  { code: "ja", flag: "\u{1F1EF}\u{1F1F5}", name: "Japanese" },
  { code: "ko", flag: "\u{1F1F0}\u{1F1F7}", name: "Korean" },
  { code: "ar", flag: "\u{1F1F8}\u{1F1E6}", name: "Arabic" },
  { code: "hi", flag: "\u{1F1EE}\u{1F1F3}", name: "Hindi" },
  { code: "it", flag: "\u{1F1EE}\u{1F1F9}", name: "Italian" },
  { code: "ru", flag: "\u{1F1F7}\u{1F1FA}", name: "Russian" },
];

export default function NewTranslationPage() {
  const [selectedLang, setSelectedLang] = useState<string | null>("fr");
  const [langOpen, setLangOpen] = useState(false);

  const selected = popularLanguages.find((l) => l.code === selectedLang);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New Translation</h1>
        <p className="text-sm text-muted-foreground">
          Translate a video into another language
        </p>
      </div>

      <Card>
        <CardContent className="space-y-6 p-6">
          {/* Source input */}
          <Tabs defaultValue="upload">
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
              <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 p-12 text-center transition-colors hover:border-primary/50 hover:bg-primary/5">
                <Upload className="h-10 w-10 text-muted-foreground" />
                <p className="mt-4 text-sm font-medium">
                  Drag and drop your video here
                </p>
                <p className="text-sm text-muted-foreground">
                  or click to browse
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  MP4, MOV, AVI, WebM — up to 500MB
                </p>
              </div>
            </TabsContent>

            <TabsContent value="link" className="mt-4 space-y-2">
              <Label htmlFor="videoUrl">Video URL</Label>
              <Input
                id="videoUrl"
                placeholder="https://youtube.com/watch?v=..."
              />
              <p className="text-xs text-muted-foreground">
                Supports YouTube, Instagram, Facebook, Vimeo
              </p>
            </TabsContent>
          </Tabs>

          <Separator />

          {/* Language selector */}
          <div className="space-y-2">
            <Label>Target Language</Label>
            <Popover open={langOpen} onOpenChange={setLangOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between"
                >
                  {selected
                    ? `${selected.flag} ${selected.name}`
                    : "Search languages..."}
                  <ChevronRight className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command>
                  <CommandInput placeholder="Search languages..." />
                  <CommandList>
                    <CommandEmpty>No language found.</CommandEmpty>
                    <CommandGroup heading="Popular">
                      {popularLanguages.map((lang) => (
                        <CommandItem
                          key={lang.code}
                          value={lang.name}
                          onSelect={() => {
                            setSelectedLang(lang.code);
                            setLangOpen(false);
                          }}
                        >
                          <span className="mr-2">{lang.flag}</span>
                          {lang.name}
                          {selectedLang === lang.code && (
                            <Check className="ml-auto h-4 w-4" />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">
              Video Title{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input id="title" placeholder="My Product Demo" />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Link to="/platform">
              <Button variant="ghost">Cancel</Button>
            </Link>
            <Link to="/platform/translations/tr_002">
              <Button className="gap-2">
                Start Translation
                <ChevronRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
