import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { createSupabaseClient } from "~/services/supabase.server";
import { resetPasswordSchema } from "~/utils/validation";
import type { Route } from "./+types/reset-password";
import { Loader2 } from "lucide-react";

export function meta() {
  return [{ title: "Reset Password — Dubly" }];
}

export async function action({ request }: Route.ActionArgs) {
  const headers = new Headers();
  const supabase = createSupabaseClient(request, headers);
  const formData = await request.formData();
  const raw = Object.fromEntries(formData);
  const parsed = resetPasswordSchema.safeParse(raw);

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const firstError = fieldErrors.password?.[0] ?? fieldErrors.confirmPassword?.[0] ?? "Invalid input";
    return { error: firstError };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    return { error: error.message };
  }

  throw redirect("/login", { headers });
}

export default function ResetPasswordPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-semibold">Set new password</CardTitle>
        <p className="text-sm text-muted-foreground">
          Enter your new password below
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {actionData?.error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {actionData.error}
          </div>
        )}

        <Form method="post" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New Password</Label>
            <Input id="password" name="password" type="password" placeholder="••••••••" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input id="confirmPassword" name="confirmPassword" type="password" placeholder="••••••••" required />
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Update Password
          </Button>
        </Form>

        <p className="text-center text-sm text-muted-foreground">
          <Link to="/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
