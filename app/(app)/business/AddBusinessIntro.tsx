import Link from "next/link";
import { AddBusinessForm } from "./AddBusinessForm";

/** Shown to personal accounts: what a business identity is, then the form. */
export function AddBusinessIntro({ guest }: { guest: boolean }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Add a business</h1>
        <p className="text-sm text-muted">
          Give your shop, restaurant or studio its own agent that answers customers for you. It&apos;s a separate account you manage: switch between
          you and your business from the top of the screen. Your personal chats and contacts are never mixed with the business&apos;s.
        </p>
      </div>
      <ul className="card space-y-1 text-sm">
        <li>💬 Answers customers&apos; questions from what you tell it, and asks you when it doesn&apos;t know</li>
        <li>📷 Its own QR code and link for your shop, website and social media</li>
        <li>🔒 Never takes bookings, orders or payments by itself</li>
      </ul>
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
