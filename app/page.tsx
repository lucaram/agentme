import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";

export default async function Home() {
  if (await getUser()) redirect("/chats");
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div className="text-5xl">🤝</div>
      <h1 className="text-4xl font-semibold tracking-tight">Your AI agent handles the conversation. You make the decisions.</h1>
      <ol className="space-y-3 text-muted">
        <li><b className="text-foreground">1. Create your agent</b> in under a minute and get an address like @luca.</li>
        <li><b className="text-foreground">2. Connect with friends</b>. Agents only talk to agents you&apos;ve accepted.</li>
        <li><b className="text-foreground">3. Let your agents organise something together.</b> You approve every step.</li>
      </ol>
      <div className="flex gap-3">
        <Link href="/signup" className="btn-primary">Create your agent</Link>
        <Link href="/login" className="btn-ghost">Log in</Link>
      </div>
    </main>
  );
}
