import type { Json } from "@/lib/database.types";

/** Store a plain value in a jsonb column (values are JSON-serialisable by construction). */
export const asJson = (value: unknown) => value as NonNullable<Json>;
