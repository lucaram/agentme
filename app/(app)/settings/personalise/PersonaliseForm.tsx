"use client";

import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { ACCENTS, DARK_STYLES, TEXT_SIZES, THEMES, TINTS, appearanceAttributes, type Appearance } from "@/lib/appearance";
import { saveAppearanceAction } from "./actions";

const SECTION_TITLE = "text-xs font-semibold uppercase tracking-wide text-muted";

/** Applies on tap (no Save button): the page changes at once, then it's saved. */
export function PersonaliseForm({ initial, name }: { initial: Appearance; name: string }) {
  const [look, setLook] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [, start] = useTransition();

  function change(patch: Partial<Appearance>) {
    const next = { ...look, ...patch };
    setLook(next);
    for (const [attr, value] of Object.entries(appearanceAttributes(next))) document.documentElement.setAttribute(attr, value);
    start(async () => {
      const result = await saveAppearanceAction(next).catch(() => ({ error: "failed" }));
      setStatus(result.error ? "error" : "saved");
    });
  }

  return (
    <div className="space-y-4">
      <Preview name={name} />
      <p className="h-4 text-right text-xs" role="status" aria-live="polite">
        {status === "saved" && <span className="text-accent">Saved ✓</span>}
        {status === "error" && <span className="text-danger">Couldn&apos;t save. It still applies on this device for now.</span>}
      </p>

      <div className="card space-y-6">
        <Choices title="Appearance" hint="System follows your phone or computer." value={look.theme} options={THEMES} onPick={(theme) => change({ theme })} />

        <section className="space-y-2">
          <h2 className={SECTION_TITLE} id="accent-title">Accent colour</h2>
          <div className="flex flex-wrap gap-3" role="radiogroup" aria-labelledby="accent-title">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={look.accent === a.id}
                aria-label={a.label}
                title={a.label}
                onClick={() => change({ accent: a.id })}
                style={{ "--sw-light": a.light, "--sw-dark": a.dark } as CSSProperties}
                className={`flex flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-xs ${look.accent === a.id ? "bg-accent-soft font-medium" : "text-muted"}`}
              >
                <span
                  className={`block h-9 w-9 rounded-full bg-[var(--sw-light)] dark:bg-[var(--sw-dark)] ${look.accent === a.id ? "ring-2 ring-foreground ring-offset-2 ring-offset-surface" : ""}`}
                  aria-hidden
                />
                {a.label}
              </button>
            ))}
          </div>
          <p className="hint">Buttons, links, highlights and your own messages. Red stays for warnings, and your agent&apos;s messages keep their own colour so you can always tell them apart.</p>
        </section>

        <Choices
          title="Background"
          hint="Tinted adds a hint of your accent colour to the page and its cards. Text stays just as easy to read."
          value={look.tint}
          options={TINTS}
          onPick={(tint) => change({ tint })}
        />

        <Choices title="Text size" value={look.text} options={TEXT_SIZES} onPick={(text) => change({ text })} />

        {look.theme !== "light" && (
          <Choices title="Dark style" hint="Black is true black: easier on OLED screens and their battery." value={look.dark} options={DARK_STYLES} onPick={(dark) => change({ dark })} />
        )}
      </div>
    </div>
  );
}

function Choices<T extends string>({ title, hint, value, options, onPick }: { title: string; hint?: string; value: T; options: readonly { id: T; label: string }[]; onPick: (v: T) => void }) {
  const id = `choice-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section className="space-y-2">
      <h2 className={SECTION_TITLE} id={id}>{title}</h2>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby={id}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onPick(o.id)}
            className={`rounded-full border px-4 py-1.5 text-sm transition ${value === o.id ? "border-accent bg-accent-soft font-medium" : "border-border bg-surface hover:border-accent"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <p className="hint">{hint}</p>}
    </section>
  );
}

/** A small sample of the app in the chosen look. */
function Preview({ name }: { name: string }) {
  return (
    <section className="card space-y-3" aria-label="Preview" data-testid="personalise-preview">
      <h2 className={SECTION_TITLE}>Preview</h2>
      <Bubble side="left">
        <div className="border border-border bg-surface">Free on Saturday for dinner? 🍝</div>
      </Bubble>
      <Bubble side="right">
        <div className="bg-accent text-white dark:text-black">Yes! Ask our agents to find a time.</div>
      </Bubble>
      <Bubble side="left">
        <div className="border border-agent-border bg-agent">
          <span className="mr-1 rounded bg-agent-border px-1 text-[10px] font-semibold uppercase">AI</span>
          {name.split(" ")[0]}&apos;s agent: Saturday 7:30 PM works for everyone.
        </div>
      </Bubble>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <span className="btn-primary pointer-events-none">Approve</span>
        <span className="btn-ghost pointer-events-none">Not now</span>
        <span className="text-sm text-accent underline">A link</span>
        <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white dark:text-black">3</span>
      </div>
    </section>
  );
}

function Bubble({ side, children }: { side: "left" | "right"; children: ReactNode }) {
  return <div className={`flex ${side === "right" ? "justify-end" : ""} [&>div]:max-w-[80%] [&>div]:rounded-2xl [&>div]:px-3 [&>div]:py-2 [&>div]:text-sm`}>{children}</div>;
}
