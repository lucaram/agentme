/** Something is being read or worked out right now: a thinking icon, gently pulsing, and what's happening. */
export function Thinking({ label, className = "" }: { label: string; className?: string }) {
  return (
    <span role="status" className={`inline-flex items-center gap-1.5 ${className}`} data-testid="thinking">
      <span className="animate-pulse" aria-hidden>💭</span>
      <span>{label}</span>
      <span className="inline-flex gap-0.5" aria-hidden>
        {[0, 200, 400].map((delay) => <span key={delay} className="h-1 w-1 animate-pulse rounded-full bg-current" style={{ animationDelay: `${delay}ms` }} />)}
      </span>
    </span>
  );
}
