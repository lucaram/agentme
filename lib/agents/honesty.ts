/**
 * Your agent's chat replies can't send, share, forward or book anything:
 * only a plan you approve on a card does. If a reply still claims (or
 * promises) one of those, code replaces it with an honest one. Pure, unit-tested.
 */

const CLAIMS: RegExp[] = [
  // English: "I've sent it", "I shared it with @marco", "I'll send it now", "Done ✅ Sent to @marco"
  /\b(?:i|i've|i have|i just|i've just|i'll|i will|let me)\s+(?:now\s+|just\s+|already\s+)?(?:sent|send|shared|share|forwarded|forward|messaged|message|emailed|email|texted|booked|book|reserved|reserve|passed (?:it|this|that|them) (?:on|along)|pass (?:it|this|that|them) (?:on|along))\b/i,
  /\bdone\b[^.\n]{0,25}\b(?:sent|shared|forwarded|booked)\b/i,
  /\b(?:sent|shared|forwarded) (?:it |this |that |the message )?(?:to|with) @[a-z0-9_]+/i,
  // Italian: "ho inviato", "l'ho mandato", "fatto, inviato a @marco"
  /\b(?:ho|l'ho|gliel'ho|abbiamo)\s+(?:gi[aà]\s+)?(?:inviato|mandato|inoltrato|condiviso|girato|prenotato|scritto a)\b/i,
  /\b(?:fatto|ok)\b[^.\n]{0,25}\b(?:inviato|mandato|inoltrato|condiviso)\b/i,
  // Spanish, French, German
  /\b(?:he|lo he|se lo he)\s+(?:enviado|mandado|compartido|reenviado|reservado)\b/i,
  /\b(?:j'ai|je l'ai|je lui ai)\s+(?:envoy[ée]|partag[ée]|transf[ée]r[ée]|r[ée]serv[ée])/i,
  /\bich habe\b[^.\n]{0,30}\b(?:gesendet|geschickt|geteilt|weitergeleitet|gebucht)\b/i,
];

/** Does this chat reply claim (or promise) to have sent, shared or booked something? */
export function claimsAction(reply: string): boolean {
  return CLAIMS.some((re) => re.test(reply));
}

/** What the agent says instead: the truth, and how to actually send it (with your approval). */
export function honestReply(reply: string, ownerText: string): string {
  const handle = (ownerText.match(/@([a-z0-9_]+)/i) ?? reply.match(/@([a-z0-9_]+)/i))?.[1];
  const to = handle ? `@${handle}` : "@name";
  return [
    "I haven't sent anything: from this chat I can't send, share or book things myself. Only a plan you approve does that.",
    `To send it, write “Share this with ${to}” (or “Tell ${to}: your message”). I'll show you exactly what will go out, and it's sent only when you tap Approve.`,
  ].join("\n\n");
}
