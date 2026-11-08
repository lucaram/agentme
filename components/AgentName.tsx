import Link from "next/link";

/**
 * A name (or avatar + name) that opens the business's page when it's a
 * business: its booking buttons and "Ask us anything". People's names stay
 * plain (only businesses have a public page).
 */
export function AgentName({
  agent,
  className = "",
  children,
}: {
  agent: { handle: string; type?: string | null } | undefined;
  className?: string;
  children: React.ReactNode;
}) {
  if (agent?.type !== "business") return <span className={className}>{children}</span>;
  return (
    <Link href={`/u/${agent.handle}`} className={`${className} hover:underline`} data-testid="business-link">
      {children}
    </Link>
  );
}
