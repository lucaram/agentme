import Link from "next/link";
import { AddBusinessForm } from "./AddBusinessForm";

/** Shown to personal accounts: what a business identity is, then the form. */
export function AddBusinessIntro({ guest }: { guest: boolean }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Add a business</h1>
        <p className="text-sm text-muted">
          Give your business its own agent. Switch between your personal account and business at the top of the screen. Extra details are optional.
        </p>
      </div>
      {guest ? (
        <p className="card text-sm">
          You&apos;re here as a guest. <Link href="/settings/profile#account" className="font-medium text-accent underline">Save your account</Link> first, then add
          your business.
        </p>
      ) : (
        <section className="card">
          <AddBusinessForm />
        </section>
      )}
    </div>
  );
}
