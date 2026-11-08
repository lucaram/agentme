/**
 * How plans describe the people in them: named when there are a few
 * ("@marco", "@marco and @paul"), "everyone" only for bigger groups. Never
 * "each of them" for a single person. Pure: used by the composer's preview and
 * the plan card.
 */

const MAX_NAMED = 3;

/** "@marco" · "@marco and @paul" · "@a, @b and @c" · "everyone (5 people)" */
export function who(handles: string[]): string {
  const named = handles.map((h) => `@${h}`);
  if (named.length === 0) return "nobody yet";
  if (named.length === 1) return named[0];
  if (named.length > MAX_NAMED) return `everyone (${named.length} people)`;
  return `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
}

/** Step wording, by the people the plan includes (not counting the organiser). */
export const stepWords = {
  collect: (people: string[]) =>
    people.length === 1 ? `Ask ${who(people)}'s agent for` : people.length > MAX_NAMED ? "Ask their agents for" : `Ask the agents of ${who(people)} for`,
  question: (people: string[]) => (people.length > MAX_NAMED ? `Ask each of the ${people.length} people personally` : `Ask ${who(people)} personally`),
  invite: (people: string[]) => `Invite ${who(people)} to`,
  vote: (people: string[]) => (people.length > MAX_NAMED ? "Everyone votes" : `You and ${who(people)} vote`),
  claim: (people: string[]) => (people.length > MAX_NAMED ? "Everyone claims their own" : `You and ${who(people)} each claim your own`),
};
