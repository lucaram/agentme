/**
 * 💡 Ideas: one tap fills the message box with something the agent can do
 * (or opens a page, for business shortcuts). Each one teaches an ability the
 * user wouldn't think to ask for, filled with real names. Pure (no server code).
 */
export type Idea = { label: string; text?: string; href?: string; used?: boolean };

/** Ideas already tried move to the end, so new abilities come first. */
const fresh = (ideas: Idea[]) => [...ideas.filter((i) => !i.used), ...ideas.filter((i) => i.used)].map(({ label, text, href }) => ({ label, text, href }));

/** My Agent (a person). `used`: plan kinds already made ("poll", "assign", "ask_around", "venue", "introduce"…). */
export function personalIdeas(opts: { friends: string[]; business: string | null; used: Set<string> }): Idea[] {
  const [first, second] = opts.friends;
  const a = first ? `@${first}` : "@friend";
  const b = second ? `@${second}` : null;
  const both = b ? `${a} and ${b}` : a;
  const ideas: Idea[] = [
    // At a business you know: the plan shows its booking buttons.
    {
      label: "🍝 Dinner",
      text: opts.business ? `Arrange dinner at @${opts.business} with ${both} on Saturday evening` : `Arrange dinner with ${both} on Saturday evening`,
      used: opts.used.has("coordinate") || opts.used.has("composed") || opts.used.has("venue"),
    },
    { label: "⚽ Five-a-side", text: `Organise five-a-side on Thursday at 7pm with ${both}, need 3, someone bring a ball and bibs`, used: opts.used.has("rsvp") },
    { label: "🔎 Ask around", text: "Does anyone know a good plumber near me?", used: opts.used.has("ask_around") },
    ...(b ? [{ label: "🤝 Introduce", text: `Introduce ${a} to ${b}, you both love climbing`, used: opts.used.has("introduce") }] : []),
    { label: "📊 Polls", text: `Ask ${both} to vote: cinema on Friday or Saturday`, used: opts.used.has("poll") },
    { label: "🧺 Who brings what", text: `Ask ${both} who brings what for Sunday's BBQ: meat, drinks and salad`, used: opts.used.has("assign") },
    { label: "🧠 Remember", text: "What did we agree for Saturday?" },
  ];
  return fresh(ideas);
}

/** My Agent (a business): shortcuts to what makes its agent good. */
export function businessIdeas(): Idea[] {
  return [
    { label: "🧪 Test your agent", href: "/business#test-your-agent" },
    { label: "📅 Add how to book", href: "/business#book-or-order" },
    { label: "📷 Print your QR poster", href: "/print/qr" },
    { label: "🏟️ Start a community for your customers", href: "/communities" },
    { label: "🔗 Add your menu or website", href: "/business#website" },
  ];
}

/**
 * Groups and communities: what "@agent" can do there (privately, for you) and,
 * when a business is placed there, asking it.
 */
export function chatIdeas(opts: { kind: "group" | "channel"; business: string | null; moderator: boolean }): Idea[] {
  if (opts.kind === "group") {
    return [
      { label: "📝 Catch up", text: "@agent summarise" },
      { label: "🗓️ Plan", text: "@agent organise dinner with everyone on Friday" },
      { label: "📊 Polls", text: "@agent ask everyone to vote: Friday or Saturday" },
      { label: "✍️ Draft a reply", text: "@agent draft a reply: I can't make it this time" },
      { label: "🌐 Translate", text: "@agent translate to Italian" },
      ...(opts.business ? [{ label: "🍝 Ask the business", text: `@${opts.business} do you have a table for 6 on Friday?` }] : []),
    ];
  }
  return [
    { label: "📝 Catch up", text: "@agent summarise today's chat" },
    { label: "🌐 Translate", text: "@agent translate to English" },
    ...(opts.moderator ? [{ label: "✍️ Welcome message", text: "@agent draft a welcome for new members" }] : []),
    ...(opts.business ? [{ label: "🤝 Ask a partner", text: `@${opts.business} do you offer a discount for members?` }] : []),
  ];
}
