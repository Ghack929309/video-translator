import { redirect } from "react-router";
import { createSupabaseClient } from "~/services/supabase.server";
import type { Route } from "./+types/callback";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const headers = new Headers();

  if (code) {
    const supabase = createSupabaseClient(request, headers);
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      throw redirect("/platform", { headers });
    }
  }

  throw redirect("/login", { headers });
}
