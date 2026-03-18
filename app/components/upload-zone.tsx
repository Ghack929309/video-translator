import { useCallback, useRef } from "react";
import { Upload, FileVideo, X, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "~/components/ui/button";

interface UploadZoneProps {
  status: "idle" | "uploading" | "done" | "error";
  progress: number;
  fileName: string | null;
  fileSize: number | null;
  error: string | null;
  onFileSelect: (file: File) => void;
  onReset: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadZone({
  status,
  progress,
  fileName,
  fileSize,
  error,
  onFileSelect,
  onReset,
}: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) onFileSelect(file);
    },
    [onFileSelect],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFileSelect(file);
    },
    [onFileSelect],
  );

  if (status === "uploading") {
    return (
      <div className="rounded-lg border-2 border-dashed border-primary/50 bg-primary/5 p-8">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium">Uploading {fileName}...</p>
          <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{progress}%</p>
        </div>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className="rounded-lg border-2 border-dashed border-green-500/50 bg-green-500/5 p-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 text-green-500" />
            <div>
              <p className="text-sm font-medium">{fileName}</p>
              <p className="text-xs text-muted-foreground">
                {fileSize ? formatBytes(fileSize) : ""} — Upload complete
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onReset}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 p-12 text-center transition-colors hover:border-primary/50 hover:bg-primary/5"
      >
        {status === "error" ? (
          <>
            <X className="h-10 w-10 text-destructive" />
            <p className="mt-4 text-sm font-medium text-destructive">{error}</p>
            <p className="text-sm text-muted-foreground">Click to try again</p>
          </>
        ) : (
          <>
            <Upload className="h-10 w-10 text-muted-foreground" />
            <p className="mt-4 text-sm font-medium">
              Drag and drop your video here
            </p>
            <p className="text-sm text-muted-foreground">or click to browse</p>
            <p className="mt-2 text-xs text-muted-foreground">
              MP4, MOV, AVI, WebM — up to 500MB
            </p>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/x-msvideo,video/webm,video/x-matroska"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
