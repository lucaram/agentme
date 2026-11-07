import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { signOut } from "../(auth)/actions";

const NAV = [
  ["/chats", "Chats"],
  ["/contacts", "Contacts"],
  ["/discover", "Discover"],
  ["/history", "History"],
  ["/settings", "Settings"],
] as const;

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { agent } = await requireAgent();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 px-4 pt-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <Link href="/chats" className="flex items-center gap-2 font-semibold">
            <span className="text-2xl">{agent.avatar}</span>
            <span>@{agent.handle}</span>
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-normal text-accent">
              {agent.type === "business" ? "Business" : "Personal"}
            </span>
          </Link>
          <form action={signOut}>
            <button className="text-sm text-muted hover:underline">Log out</button>
          </form>
        </div>
        <nav className="-mx-1 mt-2 flex gap-1 overflow-x-auto pb-2 text-sm">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="rounded-full px-3 py-1 hover:bg-accent-soft">
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <div className="flex flex-1 flex-col px-4 py-4">{children}</div>
    </div>
  );
}
