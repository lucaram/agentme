"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode, type RefObject } from "react";
import { PAGE_ACCENTS, PAGE_ACCENT_CLASSES, PAGE_PARTS, type PageSettings } from "@/lib/business/public-page";
import { saveCoverAction, savePublicPageAction } from "./page-actions";

type Out = { error?: string; saved?: boolean } | undefined;

/**
 * Public page & sharing, top to bottom: cover, what the page shows, button colour, then where to
 * change the rest (`whereToChange`), with the page itself as a live preview alongside.
 */
export function PublicPageEditor({ handle, revision, settings, cover, whereToChange }: {
  handle: string;
  /** Changes whenever something shown on the page is saved anywhere in My Business: the preview reloads. */
  revision: string;
  settings: PageSettings;
  cover: string | null;
  whereToChange: ReactNode;
}) {
  // A new preview after each save (the page is reloaded inside the frame).
  const [version, setVersion] = useState(0);
  const coverForm = useRef<HTMLFormElement>(null);
  const coverFile = useRef<HTMLInputElement>(null);
  const lookForm = useRef<HTMLFormElement>(null);
  const preview = useRef<HTMLIFrameElement>(null);
  // What the page shows and its colour: applied to the preview at once, then saved (no Save button).
  const [look, setLook] = useState<"saving" | "saved" | "error" | null>(null);
  const [, save] = useTransition();
  const onLookChange = () => {
    const form = lookForm.current;
    if (!form) return;
    const data = new FormData(form);
    showInPreview(preview.current, String(data.get("accent") ?? ""), data.getAll("show").map(String));
    setLook("saving");
    save(async () => {
      const result = await savePublicPageAction(undefined, data).catch(() => ({ error: "failed" }));
      setLook(result.error ? "error" : "saved");
    });
  };
  const [coverState, saveCover, savingCover] = useActionState(async (prev: Out, form: FormData) => {
    const result = await saveCoverAction(prev, form);
    if (result.saved) setVersion((v) => v + 1);
    if (coverFile.current) coverFile.current.value = "";
    return result;
  }, undefined);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_minmax(0,22rem)]">
      <div className="space-y-5">
        {/* Choosing a file uploads it straight away, like "Upload photo or logo" for the avatar. */}
        <form ref={coverForm} action={saveCover} className="space-y-2" aria-label="Cover image" data-testid="page-cover">
          <p className="text-sm font-medium">Cover image</p>
          <p className="hint">A wide photo of your place or products, shown at the top of your page (it&apos;s cropped to 3:1).</p>
          {cover && (
            // eslint-disable-next-line @next/next/no-img-element -- served by our own route, already sized
            <img key={`${cover}:${version}`} src={cover} alt="Your current cover" className="aspect-[3/1] w-full rounded-xl object-cover" />
          )}
          <input
            ref={coverFile}
            type="file"
            name="cover"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            aria-label="Choose a cover image"
            onChange={(e) => {
              if (e.target.files?.length) coverForm.current?.requestSubmit();
            }}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" disabled={savingCover} onClick={() => coverFile.current?.click()}>
              {savingCover ? "Uploading…" : cover ? "Change cover" : "Upload cover"}
            </button>
            {cover && (
              <button className="btn-ghost text-muted" name="remove" value="1" disabled={savingCover}>
                Remove cover
              </button>
            )}
          </div>
          {coverState?.error && <p className="text-sm text-danger" role="alert">{coverState.error}</p>}
        </form>

        <form ref={lookForm} onChange={onLookChange} onSubmit={(e) => e.preventDefault()} className="space-y-4 border-t border-border pt-4" aria-label="Page look" data-testid="page-look">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">What your page shows</legend>
            {PAGE_PARTS.map((p) => (
              <label key={p.id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="show" value={p.id} defaultChecked={settings.show[p.id]} className="mt-1" />
                <span>
                  {p.label}
                  <span className="block hint">{p.hint}</span>
                </span>
              </label>
            ))}
            <p className="hint">Only what visitors see on the page. Your agent still knows and uses all of it when customers ask.</p>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Button colour on your page</legend>
            <p className="hint">
              Colours the buttons visitors tap: &ldquo;Ask us anything&rdquo; is filled with it, and your customer action buttons get an outline and a light tint of it.
            </p>
            <div className="space-y-2" role="radiogroup" aria-label="Button colour on your page">
              <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                <input type="radio" name="accent" value="" defaultChecked={!settings.accent} className="sr-only" />
                Each visitor&apos;s own app colour
              </label>
              <div className="grid grid-cols-3 gap-2">
              {PAGE_ACCENTS.map((a) => (
                <label
                  key={a.id}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
                  style={{ "--sw-light": a.light, "--sw-dark": a.dark } as CSSProperties}
                >
                  <input type="radio" name="accent" value={a.id} defaultChecked={settings.accent === a.id} className="sr-only" />
                  <span className="h-3.5 w-3.5 rounded-full bg-[var(--sw-light)] dark:bg-[var(--sw-dark)]" aria-hidden />
                  {a.label}
                </label>
              ))}
              </div>
            </div>
          </fieldset>
          <p className="h-4 text-xs" role="status" aria-live="polite">
            {look === "saving" && <span className="text-muted">Saving…</span>}
            {look === "saved" && <span className="text-accent">Saved ✓</span>}
            {look === "error" && <span className="text-danger">Couldn&apos;t save. Please try again.</span>}
          </p>
        </form>

        <div className="border-t border-border pt-4">{whereToChange}</div>
      </div>

      <div className="space-y-2">
        <div>
          <p className="text-sm font-medium">Preview</p>
          <p className="hint">
            Buttons can&apos;t be clicked here. To try them, open{" "}
            <a href={`/u/${handle}`} target="_blank" rel="noopener" className="text-accent underline">See your page</a>
          </p>
        </div>
        <PagePreview key={`${revision}:${version}`} src={`/u/${handle}?preview=${revision}.${version}`} frame={preview} />
      </div>
    </div>
  );
}

/**
 * The public page in a frame as tall as the page itself: no scroll bar of its own. The page is ours
 * (same origin), so its height is read once loaded and followed if it changes (images, fonts).
 */
function PagePreview({ src, frame }: { src: string; frame: RefObject<HTMLIFrameElement | null> }) {
  const [height, setHeight] = useState(640);
  const watcher = useRef<ResizeObserver | null>(null);
  const measure = () => {
    const doc = frame.current?.contentDocument;
    if (!doc?.body) return;
    // The frame's own border is part of its height.
    const border = (frame.current?.offsetHeight ?? 0) - (frame.current?.clientHeight ?? 0);
    const fit = () => setHeight(Math.ceil(doc.body.scrollHeight) + border);
    fit();
    watcher.current?.disconnect();
    watcher.current = new ResizeObserver(fit);
    watcher.current.observe(doc.body);
  };
  // The frame can finish loading before this page's script is running: measure now as well as on load.
  useEffect(() => {
    if (frame.current?.contentDocument?.readyState === "complete") measure();
    return () => watcher.current?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the frame is first shown
  }, []);
  return (
    <iframe
      ref={frame}
      src={src}
      title="Your public page"
      scrolling="no"
      // Only to look at: nothing in it can be clicked or reached with the keyboard (a booking link would open
      // inside the frame, Call would start a real call). "See your page" opens the real page to try them.
      inert
      tabIndex={-1}
      onLoad={measure}
      style={{ height }}
      className="pointer-events-none w-full select-none overflow-hidden rounded-2xl border border-border bg-background"
      data-testid="page-preview"
    />
  );
}

/**
 * Shows a change in the preview straight away, before it's saved: the business's own view of its page
 * has every part (hidden when off) and takes its colour from --page-accent-light / --page-accent-dark.
 */
function showInPreview(frame: HTMLIFrameElement | null, accent: string, show: string[]) {
  const page = frame?.contentDocument?.querySelector<HTMLElement>('[data-testid="business-page"]');
  if (!page) return;
  for (const part of page.querySelectorAll<HTMLElement>("[data-page-part]")) part.hidden = !show.includes(part.dataset.pagePart ?? "");
  const shades = PAGE_ACCENTS.find((a) => a.id === accent);
  const classes = PAGE_ACCENT_CLASSES.split(" ");
  if (shades) {
    page.style.setProperty("--page-accent-light", shades.light);
    page.style.setProperty("--page-accent-dark", shades.dark);
    page.classList.add(...classes);
  } else {
    page.classList.remove(...classes);
    page.style.removeProperty("--page-accent-light");
    page.style.removeProperty("--page-accent-dark");
  }
}
