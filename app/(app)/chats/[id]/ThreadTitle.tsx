"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renameThreadAction } from "../../actions";

/** A request thread's title, renamable in place. */
export function ThreadTitle({ threadId, title }: { threadId: string; title: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <div className="flex items-baseline gap-2">
        <h1 className="text-lg font-semibold" data-testid="thread-title">{title}</h1>
        <button type="button" className="text-xs text-muted hover:text-accent hover:underline" onClick={() => setEditing(true)}>Rename</button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await renameThreadAction(threadId, value);
          if (result.error) return setError(result.error);
          setEditing(false);
          router.refresh();
        });
      }}
    >
      <input className="input max-w-sm py-1" aria-label="Request name" value={value} maxLength={80} onChange={(e) => setValue(e.target.value)} autoFocus />
      <button className="btn-primary py-1" disabled={pending}>Save</button>
      <button type="button" className="btn-ghost py-1" onClick={() => setEditing(false)}>Cancel</button>
      {error && <span className="text-xs text-danger" role="alert">{error}</span>}
    </form>
  );
}
