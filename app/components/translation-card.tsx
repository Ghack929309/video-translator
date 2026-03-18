import { Link } from "react-router";
import { Video, Loader2 } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { languages } from "~/components/language-selector";

interface TranslationCardProps {
  id: string;
  videoTitle: string;
  targetLanguage: string;
  status: string;
  createdAt: string;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "COMPLETED":
      return (
        <Badge className="border-green-500/20 bg-green-500/10 text-green-500">
          Done
        </Badge>
      );
    case "PROCESSING":
      return (
        <Badge className="border-blue-500/20 bg-blue-500/10 text-blue-500">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Processing
        </Badge>
      );
    case "FAILED":
      return (
        <Badge className="border-destructive/20 bg-destructive/10 text-destructive">
          Failed
        </Badge>
      );
    default:
      return <Badge variant="secondary">Pending</Badge>;
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function TranslationCard({
  id,
  videoTitle,
  targetLanguage,
  status,
  createdAt,
}: TranslationCardProps) {
  const lang = languages.find((l) => l.code === targetLanguage);

  return (
    <Link
      to={`/platform/translations/${id}`}
      className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
          <Video className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium">{videoTitle}</p>
          <p className="text-sm text-muted-foreground">
            {lang ? `${lang.flag} ${lang.name}` : targetLanguage} &middot;{" "}
            {timeAgo(createdAt)}
          </p>
        </div>
      </div>
      <StatusBadge status={status} />
    </Link>
  );
}
