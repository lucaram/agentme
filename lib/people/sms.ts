import "server-only";

/**
 * Sending verification codes by SMS. No SMS provider is wired up yet: in
 * development (`SMS_PROVIDER=dev`, the default outside production) the code is
 * written to the server log and shown on screen instead of being texted.
 */
export function smsMode(): "dev" | "none" {
  const provider = process.env.SMS_PROVIDER ?? (process.env.NODE_ENV === "production" ? "" : "dev");
  return provider === "dev" ? "dev" : "none";
}

export async function sendSms(to: string, text: string): Promise<{ sent: boolean; dev: boolean }> {
  if (smsMode() === "dev") {
    console.info(`[sms:dev] to ${to.slice(0, 3)}…${to.slice(-4)}: ${text}`);
    return { sent: true, dev: true };
  }
  return { sent: false, dev: false };
}
