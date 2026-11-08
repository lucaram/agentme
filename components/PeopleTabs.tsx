import Link from "next/link";

/** Contacts tab: your contacts, or finding new people (the former Discover tab). */
export function PeopleTabs({ active }: { active: "contacts" | "find" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`rounded-full px-4 py-1.5 text-sm font-medium ${on ? "bg-accent text-white dark:text-black" : "border border-border hover:bg-accent-soft"}`}
    >
      {label}
    </Link>
  );
  return (
    <nav className="flex gap-2" aria-label="Contacts sections">
      {tab("/contacts", "Your contacts", active === "contacts")}
      {tab("/discover", "Find people", active === "find")}
    </nav>
  );
}
