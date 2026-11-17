import { z } from "zod";

export const TeamTransfer = z.object({ id: z.uuid(), staff_id: z.uuid(), from_supervisor: z.uuid(), to_supervisor: z.uuid(), requested_by: z.uuid(), staff_name: z.string(), from_name: z.string(), to_name: z.string(), requester_name: z.string(), status: z.enum(["pending", "accepted", "declined", "cancelled", "expired"]), created_at: z.string(), expires_at: z.string(), decided_at: z.string().nullable(), decided_by: z.uuid().nullable() });
export type TeamTransfer = z.infer<typeof TeamTransfer>;
export const TeamState = z.object({ defaultOwner: z.uuid().nullable(), transfers: TeamTransfer.array() });
export const TeamOption = z.object({ id: z.uuid(), name: z.string().nullable().transform((name) => name ?? "Former team member"), handle: z.string().nullable(), avatar: z.string(), role: z.string(), former: z.boolean() });
export type TeamOption = z.infer<typeof TeamOption>;
export const TeamOptions = z.object({ teams: TeamOption.array(), people: TeamOption.array() });
export const TeamDashboardData = z.object({ days: z.number(), scope: z.enum(["all", "team", "person"]), person: z.uuid().nullable(), start: z.string(), end: z.string(), trackingSince: z.string().nullable(), pending: z.number(), unattributed: z.number(),
  summary: z.object({ assigned: z.number(), answered: z.number(), declined: z.number(), published: z.number(), medianSeconds: z.number().nullable() }),
  people: z.array(z.object({ id: z.uuid().nullable(), name: z.string(), handle: z.string().nullable(), supervisor_id: z.uuid().nullable(), supervisor_name: z.string().nullable(), assigned: z.number(), answered: z.number(), declined: z.number(), published: z.number(), median_seconds: z.number().nullable() })),
  daily: z.array(z.object({ day: z.string(), answered: z.number(), published: z.number() })),
});
export type TeamDashboardData = z.infer<typeof TeamDashboardData>;
