import Link from "next/link";

/** "‹ Settings" and the page's title, for every settings page. */
export function SettingsHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="space-y-1">
      <Link href="/settings" className="text-sm text-accent hover:underline">‹ Settings</Link>
      <h1 className="text-lg font-semibold">{title}</h1>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** A "Saved." line after a settings form (?saved=1). */
export function SavedNote({ show, text = "Saved." }: { show: boolean; text?: string }) {
  return show ? <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm" role="status">{text}</p> : null;
}
