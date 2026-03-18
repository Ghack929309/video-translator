export function meta() {
  return [{ title: "About — Dubly" }];
}

export default function AboutPage() {
  return (
    <main className="px-6 py-20">
      <article className="prose prose-neutral dark:prose-invert mx-auto max-w-3xl">
        <h1>About Dubly</h1>
        <p>
          Dubly is a video translation platform that uses AI to dub your videos
          into 50+ languages while preserving the original speaker&apos;s voice.
        </p>
        <h2>How it works</h2>
        <p>
          Upload a video or paste a link from YouTube, Instagram, Facebook, or
          Vimeo. Choose your target language. Our pipeline transcribes, translates,
          clones the original voice, and synthesizes the dubbed audio — all
          automatically.
        </p>
        <h2>Technology</h2>
        <p>
          We combine state-of-the-art speech recognition, neural machine
          translation, and voice cloning to produce natural-sounding results.
          Each segment is time-stretched to match the original timing, so the
          dubbed audio stays in sync with the video.
        </p>
      </article>
    </main>
  );
}
