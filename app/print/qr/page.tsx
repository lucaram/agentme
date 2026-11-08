import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAgent } from "@/lib/auth";
import { permanentQr } from "@/lib/people/links";
import { PrintButton } from "./PrintButton";

/** A business's printable QR poster: for tables, the till or the menu. Always black on white. */
export default async function QrPosterPage() {
  const { agent } = await requireAgent();
  if (agent.type !== "business") redirect("/contacts");
  const qr = await permanentQr(agent.handle);
  return (
    <main className="min-h-dvh bg-white text-black">
      <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-6 py-4 print:hidden">
        <Link href="/business" className="text-sm underline">‹ Back to My Business</Link>
        <PrintButton />
      </div>
      <section className="mx-auto flex max-w-md flex-col items-center gap-5 px-6 pb-12 pt-6 text-center print:pt-16" data-testid="qr-poster">
        <div className="text-6xl">{agent.avatar}</div>
        <h1 className="text-3xl font-bold">{agent.display_name}</h1>
        <p className="text-2xl font-semibold">Scan to ask us anything</p>
        <p className="text-sm">Menu, opening hours, allergens… our AI agent answers straight away.</p>
        {/* Generated server-side from our own URL. */}
        <div className="w-72 rounded-2xl border-2 border-black bg-white p-3" data-url={qr.url} dangerouslySetInnerHTML={{ __html: qr.svg }} />
        <p className="font-mono text-sm">{qr.url.replace(/^https?:\/\//, "")}</p>
        <p className="text-xs text-neutral-500">Powered by AGENTME · @{agent.handle}</p>
      </section>
    </main>
  );
}
