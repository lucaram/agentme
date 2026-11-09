/**
 * A tap-to-open section: a summary row (icon, title, one line), highlighted while
 * open. Sections with the same `name` open one at a time.
 */
export function Fold({
  icon,
  title,
  summary,
  name,
  open = false,
  testId,
  children,
}: {
  icon: string;
  title: string;
  summary: string;
  name?: string;
  open?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <details
      name={name}
      open={open || undefined}
      className="group rounded-2xl border border-border bg-surface transition-shadow open:border-accent/60 open:bg-raised open:shadow-2xl open:ring-1 open:ring-black/10"
      data-testid={testId}
    >
      <summary className="flex items-center gap-3 px-5 py-4 sm:px-6">
        <span className="text-xl" aria-hidden>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          <span className="block truncate text-xs text-muted">{summary}</span>
        </span>
        <span className="text-muted transition group-open:rotate-90" aria-hidden>›</span>
      </summary>
      <div className="border-t border-border">{children}</div>
    </details>
  );
}
