import { redirect } from "react-router";
import { createSupabaseClient } from "~/services/supabase.server";
import { db } from "~/services/db.server";

export async function requireAuth(request: Request, headers: Headers) {
  const supabase = createSupabaseClient(request, headers);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw redirect("/login", { headers });
  }

  // Auto-create profile if authenticated user doesn't have one yet
  const profile = await db.profile.upsert({
    where: { id: user.id },
    update: {},
    create: {
      id: user.id,
      email: user.email!,
      name: user.user_metadata?.full_name ?? null,
      avatarUrl: user.user_metadata?.avatar_url ?? null,
    },
  });

  return { user, profile, supabase };
}

export async function requireAdmin(request: Request, headers: Headers) {
  const { user, profile, supabase } = await requireAuth(request, headers);

  if (profile.role !== "ADMIN") {
    throw redirect("/platform", { headers });
  }

  return { user, profile, supabase };
}
