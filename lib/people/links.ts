import "server-only";
import QRCode from "qrcode";
import { env } from "@/lib/env";
import { liveConnectToken } from "./crypto";

const base = () => env.appUrl.replace(/\/$/, "");

/** The permanent personal link: anyone who opens it can send a contact request. */
export const personalLink = (handle: string) => `${base()}/u/${handle}`;

/** The QR code shown on screen: connects instantly when scanned within 10 minutes. */
export async function liveQr(agentId: string, handle: string) {
  const { token, expiresAt } = liveConnectToken(agentId);
  const url = `${personalLink(handle)}?k=${encodeURIComponent(token)}`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  return { url, svg, expiresAt };
}
