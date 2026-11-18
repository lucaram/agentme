/** Something is being scanned or worked out right now: a small spinner and a short label. */
export function Thinking({ label, className = "" }: { label: string; className?: string }) {
  return (
    <span role="status" className={`inline-flex items-center gap-1.5 align-middle ${className}`} data-testid="thinking">
      <svg className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
        <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span>{label}</span>
    </span>
  );
}
