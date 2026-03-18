import { useState, useCallback } from "react";
import { Link as LinkIcon, CheckCircle2, AlertCircle } from "lucide-react";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import { parseVideoUrl, platformLabel } from "~/utils/url";

interface UrlInputProps {
  value: string;
  onChange: (url: string, platform: string | null) => void;
}

export function UrlInput({ value, onChange }: UrlInputProps) {
  const [touched, setTouched] = useState(false);

  const parsed = value.trim() ? parseVideoUrl(value) : null;
  const showError = touched && value.trim().length > 0 && !parsed;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const url = e.target.value;
      const result = parseVideoUrl(url);
      onChange(url, result?.platform ?? null);
    },
    [onChange],
  );

  return (
    <div className="space-y-2">
      <div className="relative">
        <LinkIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          onChange={handleChange}
          onBlur={() => setTouched(true)}
          placeholder="https://youtube.com/watch?v=..."
          className="pl-9"
        />
      </div>

      {parsed && (
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <Badge variant="secondary">{platformLabel(parsed.platform)}</Badge>
          <span className="text-xs text-muted-foreground">Detected</span>
        </div>
      )}

      {showError && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>Unsupported URL. Supports YouTube, Instagram, Facebook, Vimeo.</span>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Supports YouTube, Instagram, Facebook, Vimeo
      </p>
    </div>
  );
}
