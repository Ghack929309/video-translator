import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { env } from "~/utils/env.server";

/**
 * Request-scoped Supabase client — use in loaders/actions for auth.
 * Reads and writes session cookies from/to the request/response.
 */
export function createSupabaseClient(request: Request, headers: Headers) {
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get("Cookie") ?? "").map(
          (cookie) => ({ name: cookie.name, value: cookie.value ?? "" }),
        );
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          headers.append(
            "Set-Cookie",
            serializeCookieHeader(name, value, options),
          );
        });
      },
    },
  });
}

/**
 * Admin client — uses service_role key, bypasses RLS.
 * Use ONLY in the worker process and admin routes.
 * Never expose to the client.
 */
export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
);
