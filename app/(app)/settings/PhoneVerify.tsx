"use client";

import { useState, useTransition } from "react";
import { confirmPhoneAction, removePhoneAction, sendPhoneCodeAction } from "../people-actions";

/** Add a phone number, proven with a code, so friends who have it can find you (mutual only). */
export function PhoneVerify({ current }: { current: string | null }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  if (current && !sent) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span data-testid="verified-phone">📱 {current} ✓</span>
        <button type="button" className="text-xs text-muted underline" disabled={pending} onClick={() => start(async () => { await removePhoneAction(); })}>
          Remove
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {!sent ? (
        <div className="flex flex-wrap gap-2">
          <input className="input max-w-56" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 7700 900123" aria-label="Phone number" />
          <button
            type="button"
            className="btn-primary"
            disabled={pending || !phone.trim()}
            onClick={() =>
              start(async () => {
                const result = await sendPhoneCodeAction(phone);
                if (result.error) setMessage({ ok: false, text: result.error });
                else {
                  setSent(true);
                  setDevCode(result.devCode ?? null);
                  setMessage({ ok: true, text: "We sent you a 6-digit code." });
                }
              })
            }
          >
            Send code
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <input className="input max-w-40" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" aria-label="Code" />
          <button
            type="button"
            className="btn-primary"
            disabled={pending || code.trim().length !== 6}
            onClick={() =>
              start(async () => {
                const result = await confirmPhoneAction(phone, code);
                if (result.error) setMessage({ ok: false, text: result.error });
                else {
                  setSent(false);
                  setCode("");
                  setDevCode(null);
                  setMessage({ ok: true, text: "Phone number verified ✓" });
                }
              })
            }
          >
            Verify
          </button>
          <button type="button" className="btn-ghost" onClick={() => { setSent(false); setCode(""); setDevCode(null); setMessage(null); }}>
            Use another number
          </button>
        </div>
      )}
      {devCode && (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted" data-testid="dev-code">
          Development mode: no SMS was sent. Your code is <b className="text-foreground">{devCode}</b>.
        </p>
      )}
      {message && <p className={`text-sm ${message.ok ? "text-muted" : "text-danger"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>}
    </div>
  );
}
