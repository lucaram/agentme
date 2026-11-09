import { describe, expect, it } from "vitest";
import { claimsAction, honestReply } from "@/lib/agents/honesty";
import { heuristicCompose, referredText } from "@/lib/plans/compose";

describe("your agent never claims to have sent something it didn't", () => {
  it("catches claims and promises to send, share or book, in several languages", () => {
    for (const reply of [
      "Done ✅ Sent to @marco. I'll let you know if he replies.",
      "I've shared it with @paul.",
      "Sure! I'll send it now.",
      "I booked a table for 8pm.",
      "Fatto! L'ho inviato a Marco.",
      "Ho mandato il messaggio a @marco",
      "Lo he enviado a Marco.",
      "Je l'ai envoyé à Marco.",
      "Ich habe es an Marco gesendet.",
    ]) {
      expect(claimsAction(reply), reply).toBe(true);
    }
  });

  it("leaves honest replies alone", () => {
    for (const reply of [
      "I can't send messages from here, but here's a draft you could use.",
      "Your announcement was approved yesterday and went to the group.",
      "I asked @marco and @paul for their availability; @paul hasn't replied yet.",
      "Hi Marco! Here's the Everyeye support email: nuovo_supporto@everyeye.it",
    ]) {
      expect(claimsAction(reply), reply).toBe(false);
    }
  });

  it("says what really happened, and how to send it with your approval", () => {
    const text = honestReply("Done ✅ Sent to @marco.", "send it");
    expect(text).toContain("I haven't sent anything");
    expect(text).toContain("“Share this with @marco”");
  });
});

describe("“share this with @marco” refers to the conversation", () => {
  const recent = [
    { from: "owner" as const, text: "Il sito di @everyeye non mi fa loggare, chi contatto?" },
    { from: "agent" as const, text: "🏪 I asked @everyeye:\n\nScrivi a nuovo_supporto@everyeye.it indicando il problema.\n\n📄 From everyeye.it/faq · checked today" },
  ];

  it("“this” is your agent's latest message, without its heading", () => {
    expect(referredText(recent)).toBe("Scrivi a nuovo_supporto@everyeye.it indicando il problema.\n\n📄 From everyeye.it/faq · checked today");
    expect(referredText([])).toBe("");
  });

  it("becomes an announcement with exactly that text (sent only after approval)", () => {
    const draft = heuristicCompose("please share this information with @marco agent", [], recent);
    expect(draft.kind).toBe("plan");
    expect(draft.steps.map((s) => s.type)).toEqual(["announce"]);
    expect(draft.steps[0].message).toContain("nuovo_supporto@everyeye.it");
  });

  it("other requests aren't mistaken for it", () => {
    expect(heuristicCompose("Tell @marco: the match is at 7", [], recent).steps[0].message).toBe("the match is at 7");
    expect(heuristicCompose("Ask @marco and @paul to vote: pizza or sushi", [], recent).steps.map((s) => s.type)).toEqual(["poll"]);
  });
});

describe("where a shared message goes (shown on the approval card)", () => {
  const draft = { kind: "plan" as const, title: "Shared message", steps: [{ ...heuristicCompose("Tell @marco: hi", []).steps[0], message: "See you at 8" }] };

  it("one person: your direct chat with them", async () => {
    const { validateDraft } = await import("@/lib/plans/compose");
    const plan = validateDraft(draft, { organiser: "luca", participants: ["marco"] });
    expect(plan.ok && plan.preview[0]).toBe("Send to @marco in your direct chat, as your own message: “See you at 8”");
  });

  it("several people: a group; started inside a chat: that chat", async () => {
    const { validateDraft } = await import("@/lib/plans/compose");
    const many = validateDraft(draft, { organiser: "luca", participants: ["marco", "paul"] });
    expect(many.ok && many.preview[0]).toBe("Send your exact words as your own message: “See you at 8”");
    const inChat = validateDraft(draft, { organiser: "luca", participants: ["marco"], inChat: true });
    expect(inChat.ok && inChat.preview[0]).toBe("Send your exact words as your own message in this chat: “See you at 8”");
  });
});
