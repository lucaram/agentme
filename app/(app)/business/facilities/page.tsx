import Link from "next/link";
import { FacilitiesEditor } from "../FacilitiesEditor";
import { offeringsPage } from "../offerings-page";

export default async function FacilitiesPage() {
  const { facilities, hasSources } = await offeringsPage();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/business#prices-facilities" className="text-sm text-accent hover:underline" data-testid="back-to-knows">‹ What your agent knows</Link>
        <h1 className="mt-1 text-lg font-semibold">Facilities</h1>
        <p className="text-xs text-muted">Found in your website and documents, or added by you. Add, edit or remove any of them.</p>
      </div>
      <FacilitiesEditor facilities={facilities} hasSources={hasSources} />
    </div>
  );
}
