import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "~/components/ui/button";
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

export interface Language {
  code: string;
  flag: string;
  name: string;
}

export const languages: Language[] = [
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
  { code: "nl", flag: "\u{1F1F3}\u{1F1F1}", name: "Dutch" },
  { code: "pl", flag: "\u{1F1F5}\u{1F1F1}", name: "Polish" },
  { code: "tr", flag: "\u{1F1F9}\u{1F1F7}", name: "Turkish" },
  { code: "sv", flag: "\u{1F1F8}\u{1F1EA}", name: "Swedish" },
  { code: "th", flag: "\u{1F1F9}\u{1F1ED}", name: "Thai" },
  { code: "vi", flag: "\u{1F1FB}\u{1F1F3}", name: "Vietnamese" },
  { code: "id", flag: "\u{1F1EE}\u{1F1E9}", name: "Indonesian" },
  { code: "uk", flag: "\u{1F1FA}\u{1F1E6}", name: "Ukrainian" },
];

interface LanguageSelectorProps {
  value: string | null;
  onChange: (code: string) => void;
}

export function LanguageSelector({ value, onChange }: LanguageSelectorProps) {
  const [open, setOpen] = useState(false);
  const selected = languages.find((l) => l.code === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {selected ? `${selected.flag} ${selected.name}` : "Select language..."}
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder="Search languages..." />
          <CommandList>
            <CommandEmpty>No language found.</CommandEmpty>
            <CommandGroup>
              {languages.map((lang) => (
                <CommandItem
                  key={lang.code}
                  value={lang.name}
                  onSelect={() => {
                    onChange(lang.code);
                    setOpen(false);
                  }}
                >
                  <span className="mr-2">{lang.flag}</span>
                  {lang.name}
                  {value === lang.code && (
                    <Check className="ml-auto h-4 w-4" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
