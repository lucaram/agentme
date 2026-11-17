"use client";

import { useState, useTransition } from "react";
import { leaveBusinessAction } from "../team-actions";

/** Settings → Profile & account → Leave business: what leaving does, then a second, explicit tap. */
export function LeaveBusiness({ business, role, soleOwner }: { business: string; role: "owner" | "manager" | "staff"; soleOwner: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const reportsTo = role === "staff" ? "the Owners and the Manager you report to are told" : role === "manager" ? "the Owners and the Staff who report to you are told" : "the other Owners are told";

  return (
    <section className="card space-y-3 border-danger" aria-label="Leave business" data-testid="leave-business">
      <h2 className="font-semibold text-danger">Leave {business}</h2>
      {soleOwner ? (
        <p className="text-sm text-muted">
          You&apos;re the only Owner, so you can&apos;t leave yet. Make someone else an Owner in My Business → Team, or delete the business, first.
        </p>
      ) : (
        <>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Only your access to {business} is removed. Your personal account, chats and contacts stay as they are.</li>
            {role !== "owner" && <li>Requests assigned to you that aren&apos;t answered yet go back to the team.</li>}
            {role !== "staff" && <li>Staff who report to you will report to the business&apos;s receiving Owner.</li>}
            <li>Your previous work and the business&apos;s records of it stay.</li>
            <li>In their My Agent, {reportsTo}.</li>
            <li>You&apos;re taken back to your personal account. To work here again, an Owner or Manager has to invite you.</li>
          </ul>
          {!confirming ? (
            <button type="button" className="btn-danger" onClick={() => setConfirming(true)}>
              Leave business…
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm leaving">
              <button
                type="button"
                className="btn-danger"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const result = await leaveBusinessAction();
                    if (result?.error) setError(result.error);
                  })
                }
              >
                {pending ? "Leaving…" : `Yes, leave ${business}`}
              </button>
              <button type="button" className="btn-ghost" disabled={pending} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </>
      )}
    </section>
  );
}
