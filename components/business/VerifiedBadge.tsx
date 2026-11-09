/** "✓ trattoria-camden.co.uk": the business proved this website is theirs. */
export function VerifiedBadge({ domain, className = "" }: { domain: string | null | undefined; className?: string }) {
  if (!domain) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent ${className}`} title={`Verified: this business owns ${domain}`} data-testid="verified-domain">
      ✓ {domain}
    </span>
  );
}
