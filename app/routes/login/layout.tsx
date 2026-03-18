import { Link, Outlet } from "react-router";
import { Languages } from "lucide-react";

export default function LoginLayout() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Link to="/" className="mb-8 flex items-center gap-2">
        <Languages className="h-6 w-6 text-primary" />
        <span className="text-xl font-bold">Dubly</span>
      </Link>
      <Outlet />
      <Link
        to="/"
        className="mt-8 text-sm text-muted-foreground hover:text-foreground"
      >
        &larr; Back to home
      </Link>
    </div>
  );
}
