import Link from "next/link";

/**
 * A name (or avatar + name) that opens the business's page when it's a
 * business: its booking buttons and "Ask us anything". People's names stay
 * plain (only businesses have a public page).
 */
export function AgentName({
  agent,
  className = "",
  pageHint = false,
  children,
}: {
  agent: { handle: string; type?: string | null } | undefined;
  className?: string;
  /** Show a small "Page ›" tag, so it's clear on a phone (no hover) that the name opens a page. */
  pageHint?: boolean;
  children: React.ReactNode;
}) {
  if (agent?.type !== "business") return <span className={className}>{children}</span>;
  return (
    <Link href={`/u/${agent.handle}`} className={`${className} hover:underline`} data-testid="business-link">
      {children}
      {pageHint && <span className="ml-2 inline-block rounded-full bg-accent-soft px-2 py-0.5 align-middle text-[11px] font-medium text-accent no-underline">Page ›</span>}
    </Link>
  );
}
