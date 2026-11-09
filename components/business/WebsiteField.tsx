"use client";

import { useState, useTransition } from "react";
import { previewWebsiteAction } from "@/app/(app)/business/website-actions";
import type { SitePreview } from "@/lib/business/site";

export type WebsiteFill = SitePreview & { url: string };

/**
 * "Have a website? Paste it": fills in the form from the homepage straight
 * away; the whole site is read once the business is created. Submitted as
 * "website".
 */
export function WebsiteField({ onFilled }: { onFilled: (fill: WebsiteFill) => void }) {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<{ ok: true; domain: string } | { ok: false; message: string } | null>(null);
  const [pending, start] = useTransition();

  const read = () => {
    if (!value.trim() || pending) return;
    start(async () => {
      const r = await previewWebsiteAction(value);
      if (r.preview) {
        onFilled(r.preview);
        setResult({ ok: true, domain: r.preview.domain });
      } else setResult({ ok: false, message: r.error ?? "Couldn't read that website." });
    });
  };

  return (
    <div className="space-y-2 rounded-2xl border border-accent/50 bg-accent-soft/50 p-4" data-testid="website-field">
      <div>
        <label className="label" htmlFor="website">
          🌐 Have a website? <span className="font-normal text-muted">· optional</span>
        </label>
        <p className="hint">Paste it and your agent learns all of it: menu, prices, hours, policies. It fills in this form for you too.</p>
      </div>
      <div className="flex gap-2">
        <input
          id="website"
          name="website"
          className="input"
          inputMode="url"
          autoCapitalize="none"
          autoComplete="url"
          spellCheck={false}
          maxLength={300}
          placeholder="e.g. trattoria-camden.co.uk"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setResult(null);
          }}
          onKeyDown={(e) => {
            // Enter reads the website instead of submitting the whole form.
            if (e.key === "Enter") {
              e.preventDefault();
              read();
            }
          }}
        />
        <button type="button" className="btn-ghost shrink-0" onClick={read} disabled={pending || !value.trim()}>
          {pending ? "Reading…" : "Fill in from it"}
        </button>
      </div>
      {result?.ok && (
        <p className="text-xs text-accent" role="status" data-testid="website-filled">
          ✓ Filled in from {result.domain}. Check it below: your agent reads the whole website once you create it.
        </p>
      )}
      {result && !result.ok && (
        <p className="text-xs text-danger" role="alert">
          {result.message} You can still create your agent and add the website later in My Business.
        </p>
      )}
    </div>
  );
}
