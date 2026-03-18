import { Form, Link, useActionData, useNavigation } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { createSupabaseClient } from "~/services/supabase.server";
import { forgotPasswordSchema } from "~/utils/validation";
import { env } from "~/utils/env.server";
import type { Route } from "./+types/forgot-password";
import { Loader2 } from "lucide-react";

export function meta() {
  return [{ title: "Forgot Password — Dubly" }];
}

export async function action({ request }: Route.ActionArgs) {
  const headers = new Headers();
  const supabase = createSupabaseClient(request, headers);
  const formData = await request.formData();
  const raw = Object.fromEntries(formData);
  const parsed = forgotPasswordSchema.safeParse(raw);

  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors.email?.[0] ?? "Invalid input" };
  }

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env.APP_URL}/reset-password`,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: "Check your email for a password reset link." };
}

export default function ForgotPasswordPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-semibold">Reset password</CardTitle>
        <p className="text-sm text-muted-foreground">
          Enter your email and we&apos;ll send you a reset link
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {actionData?.error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {actionData.error}
          </div>
        )}
        {actionData?.success && (
          <div className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-500">
            {actionData.success}
          </div>
        )}

        <Form method="post" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" placeholder="you@example.com" required />
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Send Reset Link
          </Button>
        </Form>

        <p className="text-center text-sm text-muted-foreground">
          Remember your password?{" "}
          <Link to="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
