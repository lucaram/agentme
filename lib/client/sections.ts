/** Open every enclosing disclosure before navigating to content inside it. */
export function revealSection(id: string, focus = false): boolean {
  const target = document.getElementById(id);
  if (!target) return false;
  for (let section = target.closest("details"); section; section = section.parentElement?.closest("details") ?? null) section.open = true;
  if (focus) (target.matches("details") ? target.querySelector("summary") : target)?.focus({ preventScroll: true });
  target.scrollIntoView({ block: "start" });
  return true;
}
