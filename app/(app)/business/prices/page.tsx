import Link from "next/link";
import { PricesEditor } from "../PricesEditor";
import { offeringsPage } from "../offerings-page";

export default async function PricesPage() {
  const { prices, hasSources } = await offeringsPage();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/business#prices-facilities" className="text-sm text-accent hover:underline" data-testid="back-to-knows">‹ What your agent knows</Link>
        <h1 className="mt-1 text-lg font-semibold">Prices</h1>
        <p className="text-xs text-muted">Found in your website and documents. Correct, hide or add a price.</p>
      </div>
      <PricesEditor prices={prices} hasSources={hasSources} />
    </div>
  );
}
