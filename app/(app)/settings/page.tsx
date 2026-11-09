import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isManagedLogin } from "@/lib/identities";

const CONTACT_POLICY: Record<string, string> = { contacts_only: "Only contacts", anyone: "Anyone", nobody: "Nobody" };

/** Settings: a short menu; each row shows a summary and opens its own page. */
export default async function SettingsPage() {
  const { user, agent } = await requireAgent();
  const supabase = await createClient();
  const [{ data: facts }, { count: tips }] = await Promise.all([
    supabase.from("agent_facts").select("disclosure"),
    supabase.from("agent_tips").select("*", { count: "exact", head: true }),
  ]);
  const personal = agent.type === "personal";
  const managedBusiness = isManagedLogin(user.email);
  const shared = (facts ?? []).filter((f) => f.disclosure === "contacts").length;

  const rows: { href: string; icon: string; title: string; summary: string; testId?: string; highlight?: boolean }[] = [
    {
      href: "/settings/profile",
      icon: "👤",
      title: "Profile & account",
      summary: agent.guest
        ? "You're a guest: save your account to keep it"
        : `${agent.display_name} · @${agent.handle}${!managedBusiness && user.email ? ` · ✉️ ${user.emailConfirmed ? "verified" : "not verified"}` : ""}`,
      testId: "profile-link",
      highlight: agent.guest,
    },
    personal
      ? {
          href: "/settings/about",
          icon: "🧠",
          title: "What your agent knows about you",
          summary: facts?.length
            ? `${facts.length} ${facts.length === 1 ? "topic" : "topics"} · ${shared} shared with contacts' agents when asked`
            : "When you're free, food & drink, hobbies, where you are, and more",
          testId: "about-you-link",
        }
      : {
          href: "/business",
          icon: "🏪",
          title: "Business information",
          summary: "What your agent knows is managed in My Business",
        },
    {
      href: "/settings/privacy",
      icon: "🔐",
      title: "Privacy",
      summary: [
        CONTACT_POLICY[agent.contact_policy] ?? agent.contact_policy,
        agent.group_add_policy === "nobody" ? "Group invites only" : "Contacts can add you to groups",
        ...(personal && !agent.guest && !managedBusiness ? [agent.discoverable ? "Findable" : "Not findable"] : []),
      ].join(" · "),
      testId: "privacy-link",
    },
    ...(personal
      ? [
          {
            href: "/settings/tips",
            icon: "💡",
            title: "Saved tips",
            summary: tips ? `${tips} ${tips === 1 ? "tip" : "tips"} your agent can share when friends ask around` : "Tips your agent can share when friends ask around",
            testId: "tips-link",
          },
        ]
      : []),
    {
      href: "/history",
      icon: "📜",
      title: "Activity",
      summary: "Everything your agent did: plans, what it asked and what it shared",
      testId: "activity-link",
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Settings</h1>
      <nav aria-label="Settings" className="space-y-2">
        {rows.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className={`card flex items-center gap-3 hover:bg-accent-soft ${r.highlight ? "border-accent" : ""}`}
            data-testid={r.testId}
          >
            <span className="text-xl" aria-hidden>{r.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{r.title}</span>
              <span className="block truncate text-xs text-muted">{r.summary}</span>
            </span>
            <span className="text-accent" aria-hidden>›</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
