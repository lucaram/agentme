import { SIGNUP_LIMITS } from "@/lib/social/limits";
import { validateHandle } from "@/lib/policy/handles";

export const optionalText = (value: FormDataEntryValue | null) => typeof value === "string" && value.trim() ? value.trim() : null;
export type BusinessSignupDetails = { description: string | null; hours: string | null; faqs: { q: string; a: string }[] };

/** The same optional business fields and validation at both creation entry points. */
export function businessSignupDetails(form: FormData): { ok: true; details: BusinessSignupDetails } | { ok: false; error: string } {
  const description = optionalText(form.get("description")) ?? optionalText(form.get("about")); const hours = optionalText(form.get("hours"));
  if ((description?.length ?? 0) > SIGNUP_LIMITS.description) return { ok: false, error: `Keep About your business to ${SIGNUP_LIMITS.description} characters.` };
  if ((hours?.length ?? 0) > SIGNUP_LIMITS.hours) return { ok: false, error: `Keep opening hours to ${SIGNUP_LIMITS.hours} characters.` };
  const faqs: BusinessSignupDetails["faqs"] = [];
  for (const i of [1, 2, 3]) {
    const q = optionalText(form.get(`faq_q_${i}`)); const a = optionalText(form.get(`faq_a_${i}`));
    if (Boolean(q) !== Boolean(a)) return { ok: false, error: `Question ${i}: add both the question and answer, or remove it.` };
    if ((q?.length ?? 0) > SIGNUP_LIMITS.faqQuestion || (a?.length ?? 0) > SIGNUP_LIMITS.faqAnswer) return { ok: false, error: `Question ${i}: keep questions to ${SIGNUP_LIMITS.faqQuestion} and answers to ${SIGNUP_LIMITS.faqAnswer} characters.` };
    if (q && a) faqs.push({ q, a });
  }
  return { ok: true, details: { description, hours, faqs } };
}

export function handleCandidates(name: string) {
  let base = name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20);
  if (base.length < 3) base = `${base || "user"}_me`;
  if (!validateHandle(base).ok) base = `${base.slice(0, 17)}_me`;
  return [base, ...Array.from({ length: 10 }, (_, i) => `${base.slice(0, 17)}_${i + 2}`)];
}
