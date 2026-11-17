"use client";

/** Shared visibility controls for personal knowledge and saved recommendations. */
export function ShareTiles({ share, onChange, name, disabled = false, privateHint = "Used for your own plans, never given to anyone.", contactsHint = "Only when a contact's plan asks for this kind of thing." }: { share: boolean; onChange: (share: boolean) => void; name: string; disabled?: boolean; privateHint?: string; contactsHint?: string }) {
  const options: [boolean, string, string, string][] = [[false, "🔒", "Only my agent", privateHint], [true, "👥", "My contacts' agents", contactsHint]];
  return <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Who can see this">{options.map(([value, icon, title, hint]) => <label key={String(value)} className={`flex items-start gap-3 rounded-xl border p-3 transition ${disabled ? "cursor-wait opacity-60" : "cursor-pointer"} ${share === value ? "border-accent bg-accent-soft" : "border-border bg-background hover:border-muted"}`}>
    <input type="radio" name={name} className="sr-only" checked={share === value} disabled={disabled} onChange={() => onChange(value)} />
    <span className="text-lg" aria-hidden>{icon}</span><span className="min-w-0"><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted">{hint}</span></span>
    <span className={`ml-auto mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${share === value ? "border-accent bg-accent" : "border-border"}`} aria-hidden />
  </label>)}</div>;
}
