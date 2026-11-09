/** Name limits shared by forms and the server (long names get cut off in lists, chats and the header). */
export const MAX_GROUP_NAME = 40;
/** A person's name: fits first and last name comfortably. */
export const MAX_PERSON_NAME = 30;
/** A business's name: they run longer ("Trattoria da Luca – Camden"). */
export const MAX_BUSINESS_NAME = 40;
export const MIN_NAME = 2;

export const maxNameFor = (type: "personal" | "business" | string) => (type === "business" ? MAX_BUSINESS_NAME : MAX_PERSON_NAME);
