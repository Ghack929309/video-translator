export type VideoPlatform = "YOUTUBE" | "INSTAGRAM" | "FACEBOOK" | "VIMEO";

interface ParsedVideoUrl {
  platform: VideoPlatform;
  url: string;
}

const patterns: { platform: VideoPlatform; regex: RegExp }[] = [
  {
    platform: "YOUTUBE",
    regex: /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/)|youtu\.be\/)[\w-]+/,
  },
  {
    platform: "INSTAGRAM",
    regex: /^https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p|tv)\/[\w-]+/,
  },
  {
    platform: "FACEBOOK",
    regex: /^https?:\/\/(?:www\.|m\.)?(?:facebook\.com|fb\.watch)\/.+/,
  },
  {
    platform: "VIMEO",
    regex: /^https?:\/\/(?:www\.)?vimeo\.com\/\d+/,
  },
];

/**
 * Parse a URL and detect which video platform it belongs to.
 * Returns null if the URL doesn't match any supported platform.
 */
export function parseVideoUrl(input: string): ParsedVideoUrl | null {
  const trimmed = input.trim();
  for (const { platform, regex } of patterns) {
    if (regex.test(trimmed)) {
      return { platform, url: trimmed };
    }
  }
  return null;
}

/**
 * Returns a human-friendly label for a video platform.
 */
export function platformLabel(platform: VideoPlatform): string {
  const labels: Record<VideoPlatform, string> = {
    YOUTUBE: "YouTube",
    INSTAGRAM: "Instagram",
    FACEBOOK: "Facebook",
    VIMEO: "Vimeo",
  };
  return labels[platform];
}
