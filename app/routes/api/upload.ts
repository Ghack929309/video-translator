import { data } from "react-router";
import { requireAuth } from "~/services/middleware/auth";
import { tigris } from "~/services/tigris.server";
import type { Route } from "./+types/upload";

const ALLOWED_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "video/x-matroska",
];

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

/**
 * POST /api/upload
 * Accepts a video file via multipart FormData and uploads it to Tigris.
 * Returns { storageKey } on success.
 */
export async function action({ request }: Route.ActionArgs) {
  const headers = new Headers();
  const { profile } = await requireAuth(request, headers);

  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return data({ error: "No file provided" }, { status: 400, headers });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return data({ error: "Unsupported file type" }, { status: 400, headers });
  }

  if (file.size > MAX_FILE_SIZE) {
    return data(
      { error: "File too large (max 500MB)" },
      { status: 400, headers },
    );
  }

  const ext = file.name.split(".").pop() ?? "mp4";
  const key = `uploads/${profile.id}/${Date.now()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  await tigris.upload(key, buffer, file.type);

  return data({ storageKey: key }, { headers });
}
