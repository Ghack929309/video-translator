import { redirect } from "react-router";
import { createSupabaseClient } from "~/services/supabase.server";
import type { Route } from "./+types/logout";

export async function action({ request }: Route.ActionArgs) {
  const headers = new Headers();
  const supabase = createSupabaseClient(request, headers);
  await supabase.auth.signOut();
  throw redirect("/login", { headers });
}

export async function loader() {
  throw redirect("/login");
}
