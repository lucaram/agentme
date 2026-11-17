/** Name limits shared by forms and the server (long names get cut off in lists, chats and the header). */
export const MAX_GROUP_NAME = 40;
/** A person's name: fits first and last name comfortably. */
export const MAX_PERSON_NAME = 30;
/** A business's name: they run longer ("Trattoria da Luca – Camden"). */
export const MAX_BUSINESS_NAME = 40;
export const MIN_NAME = 2;

export const maxNameFor = (type: "personal" | "business" | string) => (type === "business" ? MAX_BUSINESS_NAME : MAX_PERSON_NAME);

/** Optional sign-up details: the same limits as where they're edited later (About you; Business → Questions & answers). */
/** My Business → What your agent knows: About (shown in full on the public page), opening hours and address. */
export const BUSINESS_LIMITS = { about: 1000, hours: 200, address: 200 } as const;

export const SIGNUP_LIMITS = {
  fact: 500, // availability, food, private notes (About you cards allow 500)
  description: 500, // a quick start; Business → About your business allows much more
  hours: 200, // the same as in My Business
  faqQuestion: 300,
  faqAnswer: 1000,
} as const;
