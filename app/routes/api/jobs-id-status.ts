import { data } from "react-router";
import { requireAuth } from "~/services/middleware/auth";
import { db } from "~/services/db.server";
import type { Route } from "./+types/jobs-id-status";

/**
 * GET /api/jobs/:id/status
 * Returns the current status, step, and progress of a translation.
 * Used by the polling hook on the translation detail page.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const headers = new Headers();
  const { profile } = await requireAuth(request, headers);

  const translation = await db.translation.findUnique({
    where: { id: params.id },
    include: {
      video: { select: { profileId: true, title: true, storageKey: true } },
    },
  });

  if (!translation || translation.video.profileId !== profile.id) {
    return data({ error: "Not found" }, { status: 404, headers });
  }

  return data(
    {
      id: translation.id,
      status: translation.status,
      currentStep: translation.currentStep,
      progress: translation.progress,
      errorMessage: translation.errorMessage,
      errorStep: translation.errorStep,
      resultVideoKey: translation.resultVideoKey,
      startedAt: translation.startedAt?.toISOString() ?? null,
      completedAt: translation.completedAt?.toISOString() ?? null,
    },
    { headers },
  );
}
