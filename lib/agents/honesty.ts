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

const FORWARD_HOW = "To pass on a message (mine, a business's or anyone's), forward it yourself: ↪ Forward on the message. It's labelled as forwarded, so people know where it came from.";
const tellHow = (to: string) => `To say something in your own words, write “Tell ${to}: your message”: I'll show you exactly what will go out, and it's sent only when you tap Approve.`;
const handleIn = (...texts: string[]) => texts.map((t) => t.match(/@([a-z0-9_]+)/i)?.[1]).find(Boolean);

/** What the agent says instead: the truth, and how to actually send it (with your approval). */
export function honestReply(reply: string, ownerText: string): string {
  const handle = handleIn(ownerText, reply);
  return [
    "I haven't sent anything: from this chat I can't send, share or book things myself. Only a plan you approve does that.",
    FORWARD_HOW,
    tellHow(handle ? `@${handle}` : "@name"),
  ].join("\n\n");
}

/**
 * "Share this with @marco", "forward that to @paul", "send him the answer above": passing on
 * something someone else (or an AI) wrote. Your agent never does that: you forward it yourself.
 * A colon means the owner wrote the message ("Tell @marco: …"), which is fine.
 */
const PASS_ON = /^\s*(?:please\s+)?(?:share|forward|send|pass|give|condividi|inoltra|manda|invia|gira)\b[^:]*\b(?:this|that|it|above|answer|info|information|questo|questa|quello|quella|la risposta|l'informazione)\b/i;

export function asksToPassOn(text: string): boolean {
  return PASS_ON.test(text) && /@[a-z0-9_]/i.test(text);
}

export function passOnReply(ownerText: string): string {
  const handle = handleIn(ownerText);
  return [`I don't pass things on myself: agents talk to agents, and people talk to people.`, FORWARD_HOW, tellHow(handle ? `@${handle}` : "@name")].join("\n\n");
}
