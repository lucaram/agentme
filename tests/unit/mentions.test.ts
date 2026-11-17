import { expect, it } from "vitest";
import { mentionAt, personAgentAsk } from "@/lib/chat/mentions";
import { validateHandle } from "@/lib/policy/handles";

it("only opens suggestions for an @ token at the caret, excluding emails and quotes/code", () => {
  expect(mentionAt("Hello @mar", 10)).toEqual({ start: 6, end: 10, query: "mar" });
  for (const text of ["luca@marco", "`@marco", "> @marco", "@marco finished"]) expect(mentionAt(text, text.length)).toBeNull();
  expect(mentionAt("@", 1)?.query).toBe(""); expect(validateHandle("agent").ok).toBe(false);
});
it("both explicit agent request wordings prepare the same question without treating a plain mention as an instruction", () => {
  for (const who of ["@Marco", "@Marco’s agent", "@Marco's agent"]) expect(personAgentAsk(`Ask ${who} whether he’s available for dinner on Saturday.`)).toEqual({ handle: "marco", question: "Are you available for dinner on Saturday?" });
  expect(personAgentAsk("@marco are you coming?")).toBeNull(); expect(personAgentAsk("Marco mentioned @paul")).toBeNull();
  expect(personAgentAsk("Ask @marco and @paul which day suits them")).toBeNull();
  expect(personAgentAsk("Ask @marco if he can bring dessert")?.question).toBe("Can you bring dessert?");
});
