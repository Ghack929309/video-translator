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

  const profile = await db.profile.findUnique({ where: { id: user.id } });
  if (!profile) {
    throw redirect("/login", { headers });
  }

  return { user, profile, supabase };
}

export async function requireAdmin(request: Request, headers: Headers) {
  const { user, profile, supabase } = await requireAuth(request, headers);

  if (profile.role !== "ADMIN") {
    throw redirect("/platform", { headers });
  }

  return { user, profile, supabase };
}
