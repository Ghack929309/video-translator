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
  Plus,
  Video,
  Settings,
  CreditCard,
  LogOut,
  ChevronRight,
  Menu,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Separator } from "~/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "~/components/ui/sheet";
import { requireAuth } from "~/services/middleware/auth";
import type { Route } from "./+types/layout";
import { useState } from "react";

export async function loader({ request }: Route.LoaderArgs) {
  const headers = new Headers();
  const { profile } = await requireAuth(request, headers);
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

const mainNav = [
  { label: "Dashboard", href: "/platform", icon: LayoutDashboard },
  { label: "Translations", href: "/platform/translations", icon: Video },
];

const secondaryNav = [
  { label: "Settings", href: "/platform/settings", icon: Settings },
  { label: "Billing", href: "/platform/billing", icon: CreditCard },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const { profile } = useLoaderData<typeof loader>();
  const initials = (profile.name ?? profile.email)
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase();

  return (
    <div className="flex h-full flex-col">
      <div className="p-6 pb-4">
        <Link to="/" className="flex items-center gap-2" onClick={onNavigate}>
          <Languages className="h-5 w-5 text-primary" />
          <span className="text-lg font-bold">Dubly</span>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {mainNav.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.href}
              to={item.href}
              onClick={onNavigate}
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

        <Link to="/platform/new" onClick={onNavigate}>
          <Button size="sm" className="mt-2 w-full gap-2">
            <Plus className="h-4 w-4" />
            New Translation
          </Button>
        </Link>

        <Separator className="my-4" />

        {secondaryNav.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.href}
              to={item.href}
              onClick={onNavigate}
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
      </nav>

      <div className="border-t border-border p-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {profile.name ?? "User"}
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
  );
}

function Breadcrumb() {
  const location = useLocation();
  const segments = location.pathname.split("/").filter(Boolean);
  const labels: Record<string, string> = {
    platform: "Platform",
    translations: "Translations",
    new: "New Translation",
    settings: "Settings",
    billing: "Billing",
  };

  return (
    <div className="flex items-center gap-1 text-sm">
      {segments.map((seg, i) => (
        <span key={seg} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          <span
            className={
              i === segments.length - 1
                ? "text-foreground"
                : "text-muted-foreground"
            }
          >
            {labels[seg] ?? seg}
          </span>
        </span>
      ))}
    </div>
  );
}

export default function PlatformLayout() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { profile } = useLoaderData<typeof loader>();
  const initials = (profile.name ?? profile.email)
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen">
      {/* Desktop Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border bg-card lg:block">
        <SidebarContent />
      </aside>

      {/* Main area */}
      <div className="lg:ml-64">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-background px-6">
          <div className="flex items-center gap-3">
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild className="lg:hidden">
                <Button variant="ghost" size="icon">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <SidebarContent onNavigate={() => setSheetOpen(false)} />
              </SheetContent>
            </Sheet>
            <Breadcrumb />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/platform/settings">Settings</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/platform/billing">Billing</Link>
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" asChild>
                <Form method="post" action="/logout">
                  <button type="submit" className="w-full text-left">
                    Sign Out
                  </button>
                </Form>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Page content */}
        <main className="px-6 py-8">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
