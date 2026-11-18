import Link from "next/link";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { PricesEditor } from "../PricesEditor";
import { PriceSources } from "../PriceSources";
import { offeringsPage } from "../offerings-page";

export default async function PricesPage() {
  const { agentId, sources, prices } = await offeringsPage();
  return (
    <div className="space-y-4">
      {/* Reading happens in the background: the page updates when it starts and ends. */}
      <RealtimeRefresh channel={`prices-${agentId}`} tables={["business_sources"]} />
      <div>
        <Link href="/business#prices-facilities" className="text-sm text-accent hover:underline" data-testid="back-to-knows">‹ What your agent knows</Link>
        <h1 className="mt-1 text-lg font-semibold">Prices</h1>
        <p className="text-xs text-muted">Read from your menu, price list or website, by category. Tap one to change it.</p>
      </div>
      <PriceSources sources={sources} empty={!prices.length} />
      <PricesEditor prices={prices} />
    </div>
  );
}
