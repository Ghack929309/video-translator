import {
  Form,
  useLoaderData,
  useActionData,
  useNavigation,
  data,
} from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Lock, Loader2, CheckCircle2 } from "lucide-react";
import { requireAuth } from "~/services/middleware/auth";
import { db } from "~/services/db.server";
import type { Route } from "./+types/settings";

export function meta() {
  return [{ title: "Settings — Dubly" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const headers = new Headers();
  const { profile } = await requireAuth(request, headers);
  return data(
    {
      profile: {
        name: profile.name ?? "",
        email: profile.email,
      },
    },
    { headers },
  );
}

export async function action({ request }: Route.ActionArgs) {
  const headers = new Headers();
  const { profile, supabase } = await requireAuth(request, headers);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update-profile") {
    const name = (formData.get("name") as string)?.trim();
    if (!name) {
      return data({ error: "Name is required", success: false }, { headers });
    }

    // Update Supabase Auth user metadata
    await supabase.auth.updateUser({ data: { full_name: name } });

    // Update profile in DB
    await db.profile.update({
      where: { id: profile.id },
      data: { name },
    });

    return data({ error: null, success: true }, { headers });
  }

  if (intent === "reset-password") {
    await supabase.auth.resetPasswordForEmail(profile.email);
    return data(
      { error: null, success: true, message: "Password reset email sent" },
      { headers },
    );
  }

  return data({ error: "Unknown action", success: false }, { headers });
}

export default function SettingsPage() {
  const { profile } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const initials = (profile.name || profile.email)
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-6">
            <input type="hidden" name="intent" value="update-profile" />

            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="text-lg">{initials}</AvatarFallback>
              </Avatar>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={profile.name} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Input
                  id="email"
                  defaultValue={profile.email}
                  disabled
                  className="pr-10"
                />
                <Lock className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground">
                Managed by Supabase Auth
              </p>
            </div>

            {actionData?.error && (
              <p className="text-sm text-destructive">{actionData.error}</p>
            )}
            {actionData?.success && !actionData?.error && (
              <p className="flex items-center gap-1 text-sm text-green-500">
                <CheckCircle2 className="h-4 w-4" />
                Changes saved
              </p>
            )}

            <div className="flex justify-end">
              <Button type="submit" disabled={isSaving} className="gap-2">
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Form method="post">
            <input type="hidden" name="intent" value="reset-password" />
            <Button type="submit" variant="outline">
              Change Password
            </Button>
          </Form>
          <p className="text-sm text-muted-foreground">
            This will send a password reset email.
          </p>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-lg text-destructive">
            Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="destructive" disabled>
            Delete Account
          </Button>
          <p className="text-sm text-muted-foreground">
            This will permanently delete your account and all translations.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
