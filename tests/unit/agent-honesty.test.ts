import { describe, expect, it } from "vitest";
import { asksToPassOn, claimsAction, honestReply, passOnReply } from "@/lib/agents/honesty";
import { heuristicCompose, validateDraft } from "@/lib/plans/compose";

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

  it("says what really happened: forward it yourself, or say it in your own words with approval", () => {
    const text = honestReply("Done ✅ Sent to @marco.", "send it");
    expect(text).toContain("I haven't sent anything");
    expect(text).toContain("↪ Forward");
    expect(text).toContain("“Tell @marco: your message”");
  });
});

describe("agents talk to agents, people talk to people: passing things on is yours to do", () => {
  it("recognises asking the agent to pass something on to a contact", () => {
    expect(asksToPassOn("please share this information with @marco agent")).toBe(true);
    expect(asksToPassOn("forward that to @paul")).toBe(true);
    expect(asksToPassOn("condividi questo con @marco")).toBe(true);
  });

  it("isn't triggered by your own words, plans or questions", () => {
    expect(asksToPassOn("Tell @marco: the match is at 7")).toBe(false);
    expect(asksToPassOn("Send @marco: I'm running late")).toBe(false);
    expect(asksToPassOn("Arrange dinner with @marco on Saturday")).toBe(false);
    expect(asksToPassOn("share this with everyone")).toBe(false);
  });

  it("explains how: ↪ Forward, or your own words", () => {
    const text = passOnReply("please share this with @marco");
    expect(text).toContain("I don't pass things on myself");
    expect(text).toContain("↪ Forward");
    expect(text).toContain("“Tell @marco: your message”");
  });
});

describe("where your own words go (shown on the approval card)", () => {
  const draft = { kind: "plan" as const, title: "Message", steps: [{ ...heuristicCompose("Tell @marco: hi").steps[0], message: "See you at 8" }] };

  it("one person: your direct chat with them (or the chat it was started in)", () => {
    const plan = validateDraft(draft, { organiser: "luca", participants: ["marco"] });
    expect(plan.ok && plan.preview[0]).toBe("Send to @marco in your direct chat, as your own message: “See you at 8”");
    const inChat = validateDraft(draft, { organiser: "luca", participants: ["marco"], inChat: true });
    expect(inChat.ok && inChat.preview[0]).toBe("Send to @marco in this chat, as your own message: “See you at 8”");
  });

  it("several people: a group", () => {
    const many = validateDraft(draft, { organiser: "luca", participants: ["marco", "paul"] });
    expect(many.ok && many.preview[0]).toBe("Send your exact words as your own message: “See you at 8”");
  });
});
