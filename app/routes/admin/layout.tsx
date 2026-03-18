import {
  data,
  Form,
  Link,
  Outlet,
  useLoaderData,
  useLocation,
} from "react-router";
import {
  Languages,
  LayoutDashboard,
  Users,
  ListTodo,
  LogOut,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Separator } from "~/components/ui/separator";
import { requireAdmin } from "~/services/middleware/auth";
import type { Route } from "./+types/layout";

export async function loader({ request }: Route.LoaderArgs) {
  const headers = new Headers();
  const { profile } = await requireAdmin(request, headers);
  return data(
    {
      profile: {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        role: profile.role,
      },
    },
    { headers },
  );
}

const adminNav = [
  { label: "Overview", href: "/admin", icon: LayoutDashboard },
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Jobs", href: "/admin/jobs", icon: ListTodo },
];

export default function AdminLayout() {
  const { profile } = useLoaderData<typeof loader>();
  const location = useLocation();
  const initials = (profile.name ?? profile.email)
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border bg-card lg:block">
        <div className="flex h-full flex-col">
          <div className="p-6 pb-4">
            <Link to="/" className="flex items-center gap-2">
              <Languages className="h-5 w-5 text-primary" />
              <span className="text-lg font-bold">Dubly</span>
            </Link>
            <span className="mt-1 inline-block rounded bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
              Admin
            </span>
          </div>

          <nav className="flex-1 space-y-1 px-3">
            {adminNav.map((item) => {
              const isActive = location.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "border-l-2 border-primary bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}

            <Separator className="my-4" />

            <Link
              to="/platform"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Platform
            </Link>
          </nav>

          <div className="border-t border-border p-4">
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {profile.name ?? "Admin"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {profile.email}
                </p>
              </div>
            </div>
            <Form method="post" action="/logout">
              <button
                type="submit"
                className="mt-3 flex w-full items-center gap-2 text-sm text-muted-foreground hover:text-destructive"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </Form>
          </div>
        </div>
      </aside>

      <div className="lg:ml-64">
        <main className="px-6 py-8">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
