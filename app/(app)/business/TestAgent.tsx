"use client";
import { useEffect, useRef } from "react";
import { TryIt } from "./BusinessForms";

export function TestAgent() {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const open = () => { if (window.location.hash === "#test-your-agent" && !dialog.current?.open) dialog.current?.showModal(); };
    open(); window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return <>
    <button id="test-your-agent" className="btn-primary shrink-0" onClick={() => dialog.current?.showModal()}>Test your agent</button>
    <dialog ref={dialog} aria-labelledby="test-agent-title" className="m-auto w-[min(95vw,40rem)] rounded-2xl border border-border bg-surface p-6 text-foreground backdrop:bg-black/50">
      <div className="mb-3 flex items-center justify-between gap-4"><h2 id="test-agent-title" className="font-semibold">Test your agent</h2><button className="btn-ghost" aria-label="Close agent preview" onClick={() => dialog.current?.close()}>✕</button></div>
      <p className="hint mb-4">Preview a customer question. Nothing is sent to anyone and this is excluded from customer activity.</p>
      <TryIt />
    </dialog>
  </>;
}
