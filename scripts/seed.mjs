// Seeds demo users/agents for local development and e2e tests.
// Usage: npm run seed   (idempotent: deletes and recreates the demo accounts)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const db = createClient(url, key, { auth: { persistSession: false } });

export const PASSWORD = "password123";

const PEOPLE = [
  {
    email: "luca@agentme.test", handle: "luca", display_name: "Luca", avatar: "🦊", type: "personal",
    facts: [
      ["availability", "Weekday evenings after 6:30 PM; Saturdays after 6 PM", "contacts"],
      ["food", "Loves Italian and Japanese", "contacts"],
      ["notes", "Saving for a new bike, so keep spending low", "private"],
    ],
  },
  {
    email: "marco@agentme.test", handle: "marco", display_name: "Marco", avatar: "🐻", type: "personal",
    facts: [
      ["availability", "Saturdays after 7 PM; Sundays all day", "contacts"],
      ["food", "Italian, no seafood", "contacts"],
      ["location", "Lives in Islington", "private"],
      ["notes", "Recovering from knee surgery, prefers places without stairs", "private"],
    ],
  },
  {
    email: "paul@agentme.test", handle: "paul", display_name: "Paul", avatar: "🦉", type: "personal",
    facts: [
      ["availability", "Saturdays after 6 PM", "contacts"],
      ["food", "Italian or Thai", "contacts"],
      ["notes", "Has a job interview on Monday", "private"],
    ],
  },
  {
    email: "eve@agentme.test", handle: "eve", display_name: "Eve", avatar: "🐍", type: "personal",
    facts: [["availability", "Any evening", "contacts"]],
  },
  {
    email: "trattoria@agentme.test", handle: "trattoria", display_name: "Trattoria Sole", avatar: "🍝", type: "business",
    contact_policy: "anyone",
    bio: "Family-run Italian restaurant in Camden.",
    business_info: {
      description: "Family-run Italian restaurant in Camden serving fresh pasta and wood-fired pizza.",
      hours: "Tue–Sun 12:00–15:00 and 18:00–23:00. Closed Mondays.",
      faqs: [
        { q: "Do you have vegetarian options?", a: "Yes, about half the menu is vegetarian, and most pasta dishes can be made vegan." },
        { q: "Do you take group bookings?", a: "Yes, for groups of up to 12. Please call 020 7946 0000 to book; I can't take bookings myself." },
        { q: "Is there step-free access?", a: "Yes: a step-free entrance and an accessible toilet." },
      ],
    },
    facts: [],
  },
];

const CONTACTS = [["luca", "marco"], ["luca", "paul"], ["marco", "paul"]];

async function deleteExisting(emails) {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const user of data.users) {
      if (emails.includes(user.email)) await db.auth.admin.deleteUser(user.id);
    }
    if (data.users.length < 200) break;
  }
}

async function main() {
  await deleteExisting(PEOPLE.map((p) => p.email));
  const agents = {};
  for (const p of PEOPLE) {
    const { data: created, error } = await db.auth.admin.createUser({ email: p.email, password: PASSWORD, email_confirm: true });
    if (error) throw error;
    const userId = created.user.id;
    const { data: agent, error: agentError } = await db
      .from("agents")
      .insert({
        owner_id: userId, handle: p.handle, display_name: p.display_name, avatar: p.avatar, type: p.type,
        contact_policy: p.contact_policy ?? "contacts_only", bio: p.bio ?? null, business_info: p.business_info ?? {},
      })
      .select("id")
      .single();
    if (agentError) throw agentError;
    agents[p.handle] = { id: agent.id, userId };
    if (p.facts.length) {
      const { error: factError } = await db.from("agent_facts").insert(
        p.facts.map(([category, value, disclosure]) => ({ agent_id: agent.id, category, value, disclosure })),
      );
      if (factError) throw factError;
    }
    const { data: conv } = await db.from("conversations").insert({ kind: "my_agent", title: "My Agent", created_by: userId }).select("id").single();
    await db.from("conversation_members").insert({ conversation_id: conv.id, user_id: userId });
    await db.from("messages").insert({
      conversation_id: conv.id, sender_agent_id: agent.id, is_ai_generated: true,
      content: `Hi ${p.display_name}! I'm your agent, @${p.handle}. Ask me to organise something with your contacts.`,
    });
  }
  for (const [a, b] of CONTACTS) {
    const { error } = await db.from("contacts").insert({ requester_agent: agents[a].id, addressee_agent: agents[b].id, status: "accepted" });
    if (error) throw error;
  }
  console.log(`Seeded ${PEOPLE.length} agents (password: ${PASSWORD}): ${PEOPLE.map((p) => "@" + p.handle).join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
