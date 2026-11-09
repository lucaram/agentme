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
  id,
  testId,
  badge,
  children,
}: {
  icon: string;
  title: string;
  summary: string;
  name?: string;
  open?: boolean;
  /** For links to it (#id): see OpenFromHash. */
  id?: string;
  testId?: string;
  /** A counter next to the arrow: green for new things, grey for a total. */
  badge?: { count: number; tone: "new" | "total" };
  children: React.ReactNode;
}) {
  return (
    <details
      id={id}
      name={name}
      open={open || undefined}
      className="group scroll-mt-40 rounded-2xl border border-border bg-surface transition-shadow open:border-accent/60 open:bg-raised open:shadow-2xl open:ring-1 open:ring-black/10"
      data-testid={testId}
    >
      <summary className="flex items-center gap-3 px-5 py-4 sm:px-6">
        <span className="text-xl" aria-hidden>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          <span className="block truncate text-xs text-muted">{summary}</span>
        </span>
        {badge && badge.count > 0 && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.tone === "new" ? "bg-accent text-white dark:text-black" : "bg-accent-soft text-muted"}`}
            aria-label={badge.tone === "new" ? `${badge.count} new` : `${badge.count} in total`}
            data-testid={testId ? `${testId}-badge` : undefined}
          >
            {badge.count > 99 ? "99+" : badge.count}
          </span>
        )}
        <span className="text-muted transition group-open:rotate-90" aria-hidden>›</span>
      </summary>
      <div className="border-t border-border">{children}</div>
    </details>
  );
}
