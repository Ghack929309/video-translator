# Video Translator MVP — UI/UX Design Specification

## Design system

### Foundation

The app uses **shadcn/ui** as the component library, built on Radix UI primitives + Tailwind CSS v4. Every component is installed locally in `app/components/ui/` and customized to match the brand. The design language is **minimal, functional, and information-dense** — closer to Linear or Vercel's dashboard than to a playful consumer app. The app deals with professional video work, so the UI should feel precise and trustworthy.

### Theme: dark and light mode

The app ships with **dark mode as the default** and a light mode toggle. Theme switching uses `next-themes`-style class strategy (`.dark` on `<html>`) integrated with shadcn's CSS variable system.

**Dark mode (default):**

```css
--background: 0 0% 3.9%; /* Near-black: hsl(0, 0%, 3.9%) */
--foreground: 0 0% 98%; /* Near-white text */
--card: 0 0% 6%; /* Slightly elevated surfaces */
--card-foreground: 0 0% 98%;
--popover: 0 0% 6%;
--primary: 262 83% 58%; /* Brand purple: hsl(262, 83%, 58%) — a vibrant violet */
--primary-foreground: 0 0% 100%;
--secondary: 0 0% 12%;
--secondary-foreground: 0 0% 98%;
--muted: 0 0% 12%;
--muted-foreground: 0 0% 63%;
--accent: 262 83% 58%;
--accent-foreground: 0 0% 100%;
--destructive: 0 84% 60%;
--border: 0 0% 12%;
--input: 0 0% 12%;
--ring: 262 83% 58%;
```

**Light mode:**

```css
--background: 0 0% 100%; /* Pure white */
--foreground: 0 0% 3.9%; /* Near-black text */
--card: 0 0% 98%; /* Very subtle gray cards */
--card-foreground: 0 0% 3.9%;
--popover: 0 0% 100%;
--primary: 262 83% 58%; /* Same brand purple */
--primary-foreground: 0 0% 100%;
--secondary: 0 0% 96%;
--secondary-foreground: 0 0% 9%;
--muted: 0 0% 96%;
--muted-foreground: 0 0% 45%;
--accent: 262 83% 58%;
--accent-foreground: 0 0% 100%;
--destructive: 0 84% 60%;
--border: 0 0% 90%;
--input: 0 0% 90%;
--ring: 262 83% 58%;
```

The brand purple (`hsl(262, 83%, 58%)`) is used sparingly: primary buttons, active navigation indicators, progress bars, and focus rings. Everything else is neutral grayscale. This creates a calm, professional canvas where the purple pops on interactive elements.

### Typography

- **Font family:** `Inter` for UI text, `JetBrains Mono` for code/technical elements (transcript timestamps, job IDs).
- **Scale:** Use Tailwind's default scale. Body text is `text-sm` (14px). Page titles are `text-2xl font-semibold`. Section headings are `text-lg font-medium`. Labels and captions are `text-xs text-muted-foreground`.
- **Line height:** Default Tailwind (`leading-normal`). Transcript text uses `leading-relaxed` for readability.

### Spacing and layout

- **Page max-width:** `max-w-6xl mx-auto` for content pages within the platform. Full-width for the site/marketing pages.
- **Page padding:** `px-6 py-8` on all platform pages.
- **Card padding:** `p-6` standard, `p-4` for compact cards (translation list items).
- **Consistent gap:** `gap-6` between major sections, `gap-4` between form fields, `gap-2` between inline elements.
- **Border radius:** `rounded-lg` for cards and modals, `rounded-md` for buttons and inputs (shadcn defaults).

### Iconography

Use `lucide-react` exclusively (bundled with shadcn). No other icon library. Common icons used throughout:

- `Upload`, `Link`, `Globe`, `Play`, `Pause`, `Download`, `Loader2` (spinning), `Check`, `X`, `AlertTriangle`, `ChevronRight`, `Sun`, `Moon`, `LogOut`, `Settings`, `LayoutDashboard`, `Languages`, `Video`, `Waveform`, `Clock`, `RotateCcw` (retry), `Shield` (admin)

### Motion and animation

- **Page transitions:** None. Instant route changes. The app should feel snappy.
- **Loading states:** Use `Loader2` icon with `animate-spin` for inline spinners. Use shadcn `Skeleton` components for content loading (cards, lists, transcripts).
- **Progress bars:** Smooth CSS transitions (`transition-all duration-500 ease-out`) on width changes. The pipeline progress bar animates between steps.
- **Hover effects:** Subtle `hover:bg-muted` on clickable rows and cards. `hover:bg-primary/90` on primary buttons (shadcn default).
- **Toasts:** Use shadcn `Sonner` (toast library) for success/error notifications. Position: bottom-right. Auto-dismiss after 5 seconds.

---

## shadcn/ui components to install

Install these components before building. This is the complete list for the entire app:

```bash
npx shadcn@latest add button card input label select textarea badge
npx shadcn@latest add dialog sheet dropdown-menu popover command
npx shadcn@latest add table tabs separator avatar skeleton
npx shadcn@latest add progress tooltip sonner switch
npx shadcn@latest add form                          # React Hook Form + Zod integration
```

---

## Global layout structure

### Root layout (`app/root.tsx`)

The root layout provides the theme context, font loading, Sonner toast container, and a `<ScrollRestoration />`. It renders `<Outlet />` with no chrome — each route group provides its own layout.

```
<html class="dark">                    ← Theme class toggles here
  <body class="bg-background text-foreground font-sans antialiased">
    <Toaster position="bottom-right" />
    <Outlet />
  </body>
</html>
```

---

## Site pages (public, no auth)

### Site layout

A minimal top navigation bar with the app content below. No sidebar. The nav is shared across all `/site/*` routes.

```
┌──────────────────────────────────────────────────────────┐
│  [Logo]   Home   Pricing   About       [Login] [Sign Up] │
│                                        ☀️/🌙 toggle       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                    <Outlet />                             │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Nav component details:**

- `max-w-6xl mx-auto` centered container
- Logo: app name in `text-lg font-bold` + a small `Languages` icon in brand purple
- Nav links: `text-sm text-muted-foreground hover:text-foreground transition-colors`
- Login button: shadcn `Button` variant `ghost`
- Sign Up button: shadcn `Button` variant `default` (purple)
- Theme toggle: shadcn `Switch` or icon button (`Sun`/`Moon`) in the nav, right-aligned
- On mobile (< `md`): collapse nav links into a shadcn `Sheet` triggered by a hamburger icon

### Home page (`/`)

The landing page. Hero section + features + CTA. Clean, high-contrast, conversion-focused.

**Hero section:**

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│              Translate any video,                         │
│            keep the original voice.                       │
│                                                          │
│   Upload a video or paste a link. Choose a language.     │
│   Get back the same video dubbed with voice cloning.     │
│                                                          │
│          [ Get Started — It's Free ]                     │
│                                                          │
│    ┌──────────────────────────────────────────────┐      │
│    │                                              │      │
│    │      [Embedded demo/preview video            │      │
│    │       or animated product screenshot          │      │
│    │       showing the pipeline in action]         │      │
│    │                                              │      │
│    └──────────────────────────────────────────────┘      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

- Headline: `text-4xl md:text-6xl font-bold tracking-tight` with a gradient on key words — `bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent` on "original voice"
- Subheadline: `text-lg text-muted-foreground max-w-2xl mx-auto`
- CTA button: Large shadcn `Button` size `lg` with `ChevronRight` icon
- Below the hero: a subtle `border` card showing a mocked-up product screenshot or short looping video demo

**Features section (3 columns below hero):**

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  🎙️ Voice Clone  │  │  🌍 50+ Languages │  │  ⚡ Fast Pipeline │
│                 │  │                 │  │                 │
│  Preserves the  │  │  Translate to    │  │  Upload, wait a  │
│  original       │  │  any major       │  │  few minutes,    │
│  speaker's      │  │  language with   │  │  download your   │
│  voice and tone │  │  natural tone    │  │  dubbed video    │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

- Each feature in a shadcn `Card` with `p-6`. Icon in brand purple (`text-primary`), title in `font-medium`, description in `text-sm text-muted-foreground`.
- Grid: `grid grid-cols-1 md:grid-cols-3 gap-6`

**"How it works" section (4 steps, horizontal):**

```
  ① Upload        →     ② Transcribe     →     ③ Translate     →     ④ Download
  Paste a link          AI extracts the        Voice-cloned           Same video,
  or drag a file        transcript             audio in target        new language
```

- Horizontal stepper with numbered circles connected by a dashed line
- Each step: number in a `w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold` circle, title below in `font-medium`, description in `text-sm text-muted-foreground`
- On mobile: stack vertically with a vertical dashed line

**Supported platforms strip:**

```
  YouTube    Instagram    Facebook    Vimeo    Direct Upload
```

- Row of muted platform icons/logos with `text-muted-foreground`, centered, `gap-8`

**Final CTA section:**

- Full-width `bg-card` band with centered headline: "Start translating videos today" + `Button` size `lg`

### Pricing page (`/pricing`)

Simple two-column pricing comparison. One free tier, one paid tier (or just the free tier for MVP).

- shadcn `Card` per tier, the recommended one gets a `border-primary ring-2 ring-primary/20` treatment
- Feature list inside each card uses `Check` icons in green for included, `X` in muted for excluded
- CTA button at bottom of each card

### About, Terms, Privacy

Plain prose pages. `max-w-3xl mx-auto` with `prose prose-neutral dark:prose-invert` Tailwind typography styling. Minimal design — just readable text.

---

## Login pages (guest only)

### Login layout

Centered card on a clean background. No sidebar, no top nav except the logo.

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│                       [Logo]                             │
│                                                          │
│              ┌──────────────────────┐                    │
│              │                      │                    │
│              │    Login / Register  │                    │
│              │    form card         │                    │
│              │                      │                    │
│              └──────────────────────┘                    │
│                                                          │
│              Back to home ←                               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

- Background: `bg-background` (the plain app background, not a special auth background)
- Card: `max-w-md mx-auto` shadcn `Card` with `p-8`
- Logo centered above the card, links back to `/`

### Login page (`/login`)

```
┌────────────────────────────────┐
│         Welcome back           │  ← Card title: text-2xl font-semibold
│   Sign in to your account      │  ← text-sm text-muted-foreground
│                                │
│   ┌──────────────────────────┐ │
│   │  Continue with Google    │ │  ← Button variant="outline", full width, Google icon
│   └──────────────────────────┘ │
│                                │
│   ┌──────────────────────────┐ │
│   │  Continue with GitHub    │ │  ← Button variant="outline", full width, GitHub icon
│   └──────────────────────────┘ │
│                                │
│   ────── or continue with ──── │  ← Separator with text
│                                │
│   Email                        │
│   ┌──────────────────────────┐ │
│   │  you@example.com         │ │  ← shadcn Input
│   └──────────────────────────┘ │
│                                │
│   Password                     │
│   ┌──────────────────────────┐ │
│   │  ••••••••                │ │  ← shadcn Input type="password"
│   └──────────────────────────┘ │
│                   Forgot password? ← Link, text-sm text-primary
│                                │
│   ┌──────────────────────────┐ │
│   │        Sign In           │ │  ← Button variant="default" (purple), full width
│   └──────────────────────────┘ │
│                                │
│   Don't have an account?       │
│   Sign up ←                    │  ← Link to /register
└────────────────────────────────┘
```

**Interaction states:**

- On submit: button text changes to `Loader2` spinner + "Signing in..." and is disabled
- Validation errors: red `text-destructive text-sm` below the relevant input, input gets `border-destructive`
- Auth errors (wrong password, etc.): shadcn `Alert` variant `destructive` at the top of the form with `AlertTriangle` icon

### Register page (`/register`)

Identical layout to login but with:

- Title: "Create your account"
- Fields: Email, Password, Confirm Password
- No "Forgot password?" link
- Footer: "Already have an account? Sign in"

### Forgot password (`/forgot-password`)

- Title: "Reset your password"
- Subtitle: "Enter your email and we'll send you a reset link."
- Single email input + "Send Reset Link" button
- On success: swap the form for a success message with `Check` icon: "Check your email for a reset link."

### Reset password (`/reset-password`)

- Title: "Set a new password"
- Fields: New Password, Confirm Password
- Button: "Update Password"
- This page is the Supabase redirect target — it reads the token from the URL hash

### OAuth callback (`/login/callback`)

No visible UI. Shows a centered `Loader2` spinner with "Signing you in..." while processing the OAuth code exchange. Redirects to `/platform` on success or `/login` with an error toast on failure.

---

## Platform pages (authenticated)

### Platform layout

A sidebar + main content layout. The sidebar is fixed on desktop, collapses to a top sheet on mobile.

```
┌─────────────┬────────────────────────────────────────────┐
│             │                                            │
│  [Logo]     │  ┌─ Breadcrumb ──────────────┐  [Avatar ▾]│
│             │  │ Platform > Translations    │  [☀️/🌙]   │
│  ─────────  │  └────────────────────────────┘            │
│             │                                            │
│  Dashboard  │                                            │
│  ● New      │         Main content area                  │
│  Translations│        (<Outlet />)                       │
│             │                                            │
│             │                                            │
│  ─────────  │                                            │
│             │                                            │
│  Settings   │                                            │
│  Billing    │                                            │
│             │                                            │
│  ─────────  │                                            │
│  Sign Out   │                                            │
│             │                                            │
└─────────────┴────────────────────────────────────────────┘
```

**Sidebar specifications:**

- Width: `w-64` on desktop (`lg:` breakpoint and up)
- Background: `bg-card` with `border-r border-border`
- Logo at top: same as site nav, `p-6 pb-4`
- Navigation items: grouped with subtle `Separator` dividers between groups
- Each nav item: `flex items-center gap-3 px-3 py-2 rounded-md text-sm` with lucide icon (16px)
- Default state: `text-muted-foreground hover:text-foreground hover:bg-muted`
- Active state: `text-foreground bg-muted font-medium` with a `2px` left border in `border-primary` (brand purple accent bar)
- "New Translation" item: styled differently — `bg-primary text-primary-foreground rounded-md` as a mini CTA button within the nav
- Bottom section (above Sign Out): user's avatar (shadcn `Avatar` with initials fallback) + name + email in `text-xs text-muted-foreground`
- Sign Out: `text-muted-foreground hover:text-destructive` with `LogOut` icon

**Top bar (right of sidebar):**

- Height: `h-14 border-b border-border`
- Left side: breadcrumb trail using `ChevronRight` separators, `text-sm text-muted-foreground`, current page in `text-foreground`
- Right side: theme toggle (icon button) + user avatar dropdown (shadcn `DropdownMenu` with Settings, Billing, Sign Out)

**Mobile layout (below `lg`):**

- Sidebar hidden. Top bar shows hamburger menu icon on the left
- Hamburger opens a shadcn `Sheet` from the left containing the full sidebar navigation
- The sheet closes on any navigation

### Dashboard page (`/platform`)

The first thing users see after login. Shows a quick overview and a prominent path to create a new translation.

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  Welcome back, Jonathan                                  │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ Total     │  │ Completed│  │ In       │               │
│  │ Videos    │  │          │  │ Progress │               │
│  │   12      │  │    8     │  │    2     │               │
│  └──────────┘  └──────────┘  └──────────┘               │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │                                                  │    │
│  │    🎬  Translate your first video                 │    │
│  │                                                  │    │
│  │    Upload a video or paste a link to get started  │    │
│  │                                                  │    │
│  │    [ New Translation ]                            │    │
│  │                                                  │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  Recent translations                           View all → │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │ 🎬 Product Demo.mp4    → French    ✅ Completed   │    │
│  │ 🎬 Interview.mp4       → Spanish   🔄 Merging     │    │
│  │ 🎬 Tutorial.mp4        → Japanese  ❌ Failed      │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Stats cards:**

- Grid: `grid grid-cols-1 sm:grid-cols-3 gap-4`
- Each card: shadcn `Card` with `p-4`, label in `text-xs text-muted-foreground uppercase tracking-wide`, value in `text-3xl font-bold`
- Optional: tiny trend indicator (`+2 this week` in `text-xs text-green-500`)

**Empty state CTA (shown when user has 0 translations):**

- Large shadcn `Card` with dashed border (`border-dashed`), centered content
- `Video` icon in `text-muted-foreground` at 48px
- Headline: `text-lg font-medium`
- Subtitle: `text-sm text-muted-foreground`
- CTA: `Button` variant `default` size `lg`

**Recent translations list:**

- Section title with "View all →" link (`text-sm text-primary`)
- Each row is a clickable card/row linking to `/platform/translations/:id`
- Shows: video title, target language with flag emoji, status badge, relative time ("2 hours ago")
- Status badges use shadcn `Badge`:
  - Completed: `bg-green-500/10 text-green-500 border-green-500/20`
  - Processing: `bg-blue-500/10 text-blue-500 border-blue-500/20` + small `Loader2` spinner
  - Failed: `bg-destructive/10 text-destructive border-destructive/20`
  - Pending: `bg-muted text-muted-foreground`

### New translation page (`/platform/new`)

The core creation flow. Two-step form: provide the video (upload or URL) → configure translation options.

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  New Translation                                         │
│  Translate a video into another language                  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │                                                  │    │
│  │  ┌─────────────────┐  ┌─────────────────┐        │    │
│  │  │ ⬆ Upload File   │  │ 🔗 Paste Link   │        │    │
│  │  └─────────────────┘  └─────────────────┘        │    │
│  │                                                  │    │
│  │  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │    │
│  │  │                                             │ │    │
│  │  │    ⬆ Drag and drop your video here          │ │    │
│  │  │    or click to browse                       │ │    │
│  │  │                                             │ │    │
│  │  │    MP4, MOV, AVI, WebM — up to 500MB        │ │    │
│  │  │                                             │ │    │
│  │  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │    │
│  │                                                  │    │
│  │  OR (when "Paste Link" tab is active):           │    │
│  │                                                  │    │
│  │  Video URL                                       │    │
│  │  ┌──────────────────────────────────────────┐    │    │
│  │  │  https://youtube.com/watch?v=...         │    │    │
│  │  └──────────────────────────────────────────┘    │    │
│  │  Supports YouTube, Instagram, Facebook, Vimeo    │    │
│  │                                                  │    │
│  │  ─────────────────────────────────────────────   │    │
│  │                                                  │    │
│  │  Target Language                                 │    │
│  │  ┌──────────────────────────────────────────┐    │    │
│  │  │  🔍 Search languages...              ▾   │    │    │
│  │  └──────────────────────────────────────────┘    │    │
│  │                                                  │    │
│  │  Video Title (optional)                          │    │
│  │  ┌──────────────────────────────────────────┐    │    │
│  │  │  My Product Demo                         │    │    │
│  │  └──────────────────────────────────────────┘    │    │
│  │                                                  │    │
│  │            [ Cancel ]   [ Start Translation ]    │    │
│  │                                                  │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Source input toggle:**

- Use shadcn `Tabs` component with two tabs: "Upload File" and "Paste Link"
- Default tab: "Upload File"
- Tab content switches between the upload zone and the URL input

**Upload zone (`upload-zone.tsx`):**

- Dashed border area: `border-2 border-dashed border-muted-foreground/25 rounded-lg p-12 text-center`
- Hover state: `border-primary/50 bg-primary/5`
- Drag-over state: `border-primary bg-primary/10` with a scale-up animation
- Icon: `Upload` at 40px in `text-muted-foreground`
- Text: "Drag and drop your video here" in `text-sm font-medium`, "or click to browse" in `text-sm text-muted-foreground`
- Accepted formats note: `text-xs text-muted-foreground mt-2`
- **After file selected:** replace the dropzone with a file preview card showing filename, size, a small video thumbnail (first frame), and a `X` button to remove and re-pick
- **During upload:** show a shadcn `Progress` bar inside the file preview card with percentage text, disable the submit button

**URL input (`url-input.tsx`):**

- Standard shadcn `Input` with placeholder "https://youtube.com/watch?v=..."
- On paste/blur: auto-detect the platform (YouTube, Instagram, Facebook, Vimeo) and show a small platform badge next to the input (e.g., a YouTube icon + "YouTube" in a `Badge`)
- Invalid URL: show `text-destructive text-sm` error below input
- Unsupported platform: show `text-destructive text-sm`: "This platform is not supported. Try YouTube, Instagram, Facebook, or Vimeo."

**Language selector (`language-selector.tsx`):**

- Use shadcn `Command` inside a `Popover` (the combobox pattern from shadcn docs)
- Searchable with `CommandInput` placeholder "Search languages..."
- Show flag emoji + language name + native name for each option (e.g., "🇫🇷 French — Français")
- Group popular languages at the top ("Popular") separated from the full alphabetical list ("All Languages")
- Selected language shows in the trigger button with flag emoji

**Submit behavior:**

- "Start Translation" button: `Button` variant `default` size `lg`
- On submit: button shows spinner + "Starting..." → form action creates Video + Translation records, enqueues job, redirects to `/platform/translations/:id`
- "Cancel" button: `Button` variant `ghost`, navigates back to `/platform`

### Translations list page (`/platform/translations`)

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  Translations                        [ New Translation ] │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │   All    │ │Completed │ │Processing│ │  Failed  │    │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │ ┌────┐                                           │    │
│  │ │ 🎬 │  Product Demo.mp4                         │    │
│  │ │    │  → French  ·  5:32  ·  2 hours ago        │    │
│  │ └────┘                          [✅ Completed]    │    │
│  ├──────────────────────────────────────────────────┤    │
│  │ ┌────┐                                           │    │
│  │ │ 🎬 │  Interview Clip.mp4                       │    │
│  │ │    │  → Spanish  ·  12:05  ·  30 min ago       │    │
│  │ └────┘                          [🔄 Merging]     │    │
│  ├──────────────────────────────────────────────────┤    │
│  │ ┌────┐                                           │    │
│  │ │ 🎬 │  Tutorial.mp4                             │    │
│  │ │    │  → Japanese  ·  8:15  ·  1 day ago        │    │
│  │ └────┘                          [❌ Failed]      │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│              ← Previous    1  2  3    Next →              │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Filter tabs:**

- Use shadcn `Tabs` with counts: "All (12)", "Completed (8)", "Processing (2)", "Failed (2)"
- Tabs update via URL search params (`?status=completed`) so filtering is bookmarkable and works with React Router loaders

**Translation row:**

- Clickable — entire row links to `/platform/translations/:id`
- Left: small video thumbnail (48x48, rounded-md, `bg-muted` placeholder if not generated)
- Center: video title in `font-medium`, metadata line below in `text-sm text-muted-foreground` showing: flag emoji + target language, duration, relative time
- Right: status `Badge` (color scheme same as dashboard)
- Hover: `hover:bg-muted/50` on the entire row

**Empty state** (per filter):

- "All" empty: same CTA card as dashboard ("Translate your first video")
- "Completed" empty: "No completed translations yet."
- "Failed" empty: "No failed translations. Nice!"

**Pagination:**

- Simple "Previous / Next" buttons (shadcn `Button` variant `outline` size `sm`) + page numbers
- 10 items per page

### Translation detail page (`/platform/translations/:id`)

The most complex page. Shows the full status of a single translation, the processing pipeline progress, and the final result.

**State: Processing**

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  ← Back to translations                                  │
│                                                          │
│  Product Demo.mp4 → French                               │
│  Started 5 minutes ago                                   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │                                                  │    │
│  │  Pipeline Progress                               │    │
│  │                                                  │    │
│  │  ✅ Download         ✅ Extract Audio              │    │
│  │  ✅ Transcribe       🔄 Translate                  │    │
│  │  ○ Clone Voice       ○ Synthesize                 │    │
│  │  ○ Merge                                         │    │
│  │                                                  │    │
│  │  ┌──────────────────────────────────────────┐    │    │
│  │  │████████████████████░░░░░░░░░░░░░░░░░░░░░│    │    │
│  │  └──────────────────────────────────────────┘    │    │
│  │  Step 4 of 7 — Translating segments...  47%      │    │
│  │                                                  │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Translation Details                              │    │
│  │                                                  │    │
│  │  Source          Product Demo.mp4                │    │
│  │  Duration        5:32                            │    │
│  │  Target          🇫🇷 French                      │    │
│  │  Status          Processing                      │    │
│  │  Created         March 18, 2026 at 2:45 PM      │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Pipeline progress component (`translation-progress.tsx`):**

- A grid of 7 step indicators, each showing: status icon + step name
- Status icons: `Check` in green circle for completed, `Loader2 animate-spin` in blue for current, empty circle (`○`) in muted for pending
- Below the grid: a shadcn `Progress` bar (0–100%) with smooth transition animation
- Below the bar: current step description + percentage in `text-sm text-muted-foreground`
- The entire card pulses subtly (`animate-pulse` on the progress text only) to indicate activity
- **Auto-refresh:** the `use-polling` hook fetches `GET /api/jobs/:id/status` every 3 seconds and updates the UI without a full page reload. When status reaches `COMPLETED`, stop polling and show the result state.

**State: Completed**

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  ← Back to translations                                  │
│                                                          │
│  Product Demo.mp4 → French                [✅ Completed] │
│  Completed 2 minutes ago                                 │
│                                                          │
│  ┌─────────────────────────┬────────────────────────┐    │
│  │                         │                        │    │
│  │   Original              │   Translated (French)  │    │
│  │  ┌───────────────────┐  │  ┌──────────────────┐  │    │
│  │  │                   │  │  │                  │  │    │
│  │  │   ▶ Video Player  │  │  │  ▶ Video Player  │  │    │
│  │  │                   │  │  │                  │  │    │
│  │  └───────────────────┘  │  └──────────────────┘  │    │
│  │                         │                        │    │
│  └─────────────────────────┴────────────────────────┘    │
│                                                          │
│         [ ⬇ Download Translated Video ]                  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Transcript                                       │    │
│  │                                                  │    │
│  │  ┌──────────────────┐  ┌──────────────────┐      │    │
│  │  │ Original         │  │ Translated       │      │    │
│  │  └──────────────────┘  └──────────────────┘      │    │
│  │                                                  │    │
│  │  [00:00] Hello everyone, welcome to our product  │    │
│  │  [00:05] demo. Today I want to show you...       │    │
│  │  [00:12] Let's start with the main dashboard...  │    │
│  │                                                  │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Video comparison:**

- Side-by-side on desktop (`grid grid-cols-2 gap-4`), stacked on mobile
- Each player in a shadcn `Card` with label above ("Original" / "Translated (French)")
- Use native `<video>` element with `controls`, `rounded-md overflow-hidden`
- Videos load via presigned Tigris URLs
- Download button: `Button` variant `default` size `lg` with `Download` icon, full width below the players
- The download button generates a fresh presigned URL on click

**Transcript viewer:**

- shadcn `Tabs`: "Original" and "Translated"
- Each transcript line: `flex gap-4` with timestamp in `text-xs font-mono text-muted-foreground w-14 shrink-0` and text in `text-sm`
- Lines have subtle `hover:bg-muted/50` and are clickable (future: clicking seeks the video to that timestamp)
- `leading-relaxed` for comfortable reading

**State: Failed**

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  ← Back to translations                                  │
│                                                          │
│  Product Demo.mp4 → French                   [❌ Failed] │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  ⚠ Translation failed                            │    │
│  │                                                  │    │
│  │  Step: Synthesize (step 6 of 7)                  │    │
│  │  Error: Fish Audio API returned 429 — rate limit │    │
│  │  exceeded. Retry attempt 3 of 3.                 │    │
│  │                                                  │    │
│  │  [ 🔄 Retry Translation ]   [ Delete ]           │    │
│  │                                                  │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

- Error card uses shadcn `Alert` variant `destructive` styling but inside a `Card` for structure
- Shows: failed step name, error message, retry count
- Retry button: `Button` variant `default` with `RotateCcw` icon — re-enqueues the job (idempotent resume)
- Delete button: `Button` variant `ghost` with `text-destructive` — confirms via shadcn `Dialog` before deleting

### Settings page (`/platform/settings`)

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  Settings                                                │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Profile                                          │    │
│  │                                                  │    │
│  │  ┌──────┐                                        │    │
│  │  │Avatar│  Change avatar                         │    │
│  │  └──────┘                                        │    │
│  │                                                  │    │
│  │  Name                                            │    │
│  │  ┌──────────────────────────────────────────┐    │    │
│  │  │  Jonathan                                │    │    │
│  │  └──────────────────────────────────────────┘    │    │
│  │                                                  │    │
│  │  Email                                           │    │
│  │  ┌──────────────────────────────────────────┐    │    │
│  │  │  jonathan@example.com            🔒      │    │    │
│  │  └──────────────────────────────────────────┘    │    │
│  │  Managed by Supabase Auth                        │    │
│  │                                                  │    │
│  │                            [ Save Changes ]      │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Password                                         │    │
│  │                                                  │    │
│  │  [ Change Password ]                              │    │
│  │  This will send a password reset email.           │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Danger Zone                                      │    │
│  │                                                  │    │
│  │  [ Delete Account ]                               │    │
│  │  This will permanently delete your account        │    │
│  │  and all translations.                            │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

- Three sections in separate `Card` components
- Email field is read-only (disabled input) with a lock icon — managed by Supabase Auth
- "Change Password" sends a reset email via `supabase.auth.resetPasswordForEmail()`
- "Delete Account" opens a confirmation `Dialog` with a text input requiring the user to type "DELETE" to confirm
- Danger zone card has a `border-destructive/30` border treatment

### Billing page (`/platform/billing`)

For the MVP, this can be a simple usage tracker — no payment integration needed yet.

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  Billing & Usage                                         │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Current Plan: Free                               │    │
│  │                                                  │    │
│  │  Translations this month:  12 / 20               │    │
│  │  ┌──────────────────────────────────────────┐    │    │
│  │  │████████████████████░░░░░░░░░░░░░░░░░░░░░│    │    │
│  │  └──────────────────────────────────────────┘    │    │
│  │                                                  │    │
│  │  Minutes processed:  47 / 100                    │    │
│  │  ┌──────────────────────────────────────────┐    │    │
│  │  │████████████████████░░░░░░░░░░░░░░░░░░░░░│    │    │
│  │  └──────────────────────────────────────────┘    │    │
│  │                                                  │    │
│  │  Resets on April 1, 2026                         │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

- Usage bars: shadcn `Progress` with fraction text above
- "Resets on" date in `text-sm text-muted-foreground`

---

## Admin pages (authenticated + admin role)

### Admin layout

Same sidebar structure as the platform but with admin-specific navigation items:

- Dashboard (stats overview)
- Users (all registered users)
- Jobs (all translation jobs)

The admin sidebar has a `Shield` icon badge and a subtle `bg-primary/5` tint to visually distinguish it from the regular platform.

### Admin dashboard (`/admin`)

Key metrics in stat cards:

```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Total     │  │ Active   │  │ Failed   │  │ Total    │
│ Users     │  │ Jobs     │  │ Jobs     │  │ Videos   │
│   142     │  │    3     │  │    7     │  │   589    │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
```

Below stats: a table of the 10 most recent jobs with columns: Job ID (mono font), User email, Video title, Target language, Status badge, Duration, Created time.

### Admin users page (`/admin/users`)

- shadcn `Table` component
- Columns: Avatar, Name, Email, Role (badge), Translations count, Joined date
- Role badge: `USER` in default badge, `ADMIN` in purple badge
- Click a row to expand inline or navigate to a user detail view
- Search input above the table to filter by name/email

### Admin jobs page (`/admin/jobs`)

- shadcn `Table` with filter tabs (All, Processing, Completed, Failed)
- Columns: Job ID (truncated, mono), User, Video title, Language, Status, Current Step, Progress bar (inline mini), Created, Duration
- Each row is clickable → navigates to `/admin/jobs/:id`
- Failed jobs have a red row background tint: `bg-destructive/5`

### Admin job detail (`/admin/jobs/:id`)

Full view of a single job:

- All Translation record fields displayed in a key-value list
- Full error message and stack trace (if failed) in a `pre` block with `bg-muted rounded-md p-4 font-mono text-xs overflow-x-auto`
- Action buttons: Retry (re-enqueue), Delete, Mark as Failed
- Timeline of step completions with timestamps

---

## Responsive breakpoints

| Breakpoint       | Behavior                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `< sm` (0–639px) | Single column. Sidebar hidden behind Sheet. Cards stack. Video players stack vertically.     |
| `sm` (640px)     | Stats cards go 2-column. Tables become horizontally scrollable.                              |
| `md` (768px)     | Stats cards go 3-column.                                                                     |
| `lg` (1024px)    | Sidebar becomes visible and fixed. Main content gets `ml-64`. Video players go side-by-side. |
| `xl` (1280px)    | Content max-width kicks in for comfortable reading. Extra whitespace on sides.               |

---

## Loading and error states

### Loading

- **Full page loads** (initial route load): shadcn `Skeleton` components matching the layout of the content being loaded. For example, the translations list shows 5 skeleton rows (rectangle + two lines of text each).
- **Inline loading** (polling, form submission): `Loader2 animate-spin` next to or replacing the relevant text. Buttons show spinner + "Processing..." and are disabled.
- **Upload progress:** shadcn `Progress` bar with percentage text.

### Error states

- **Form validation errors:** inline below each field in `text-sm text-destructive`. Use shadcn's `Form` component with Zod resolver for consistent error display.
- **API errors / server errors:** shadcn `Sonner` toast (variant: error) with brief message. For persistent errors (failed job), show an `Alert` variant `destructive` inline on the page.
- **404 pages:** centered layout with large "404" text, "Page not found" subtitle, and a "Go to Dashboard" button. Matching the auth page layout (centered card, no sidebar).
- **Unauthorized:** redirect to `/login` with a toast "Please sign in to continue."

---

## Accessibility requirements

- All interactive elements must have visible focus rings (`ring-2 ring-ring ring-offset-2 ring-offset-background` — shadcn default)
- All images and icons have `alt` text or `aria-label`
- Color is never the only indicator of status — badges always include text labels alongside color
- Form fields always have associated `<Label>` elements (shadcn `Label` component)
- Modals trap focus and close on Escape (Radix UI handles this via shadcn `Dialog`)
- The sidebar navigation is keyboard-navigable with arrow keys
- Minimum contrast ratio: 4.5:1 for body text (ensured by the HSL variable system above)
- Progress updates use `aria-live="polite"` regions so screen readers announce step changes

---

## Key component specifications

### Video player (`video-player.tsx`)

- Native `<video>` element with `controls` attribute
- Wrapped in a `rounded-lg overflow-hidden bg-black` container
- Aspect ratio: `aspect-video` (16:9)
- Shows a centered `Play` icon overlay on the poster frame before first play
- Falls back to a `bg-muted` placeholder with `Video` icon if the source URL fails to load

### Translation card (`translation-card.tsx`)

- Used in the translations list and dashboard recent translations
- Props: `translation` (includes video relation), `compact?` (for dashboard list)
- Full variant: thumbnail + title + metadata + badge, all in a `Card` with `hover:bg-muted/50 cursor-pointer transition-colors`
- Compact variant: no thumbnail, single row layout, smaller text

### Language selector (`language-selector.tsx`)

- Built on shadcn `Popover` + `Command` (combobox pattern)
- Props: `value`, `onValueChange`, `placeholder?`
- Displays selected language with flag emoji in the trigger
- Searchable — filters by language name, native name, and ISO code
- Popular languages group: English, Spanish, French, German, Portuguese, Chinese, Japanese, Korean, Arabic, Hindi
- Full list: all 50+ languages supported by Fish Audio, alphabetically

### Upload zone (`upload-zone.tsx`)

- Props: `onFileSelect`, `accept`, `maxSize`, `uploading?`, `progress?`
- Three visual states: empty (dashed border), dragover (highlighted), file-selected (preview card)
- During upload: shows `Progress` bar, disables interaction
- After upload: shows file info card with remove button
