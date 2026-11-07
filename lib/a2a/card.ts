import type { AgentCard, AgentSkill } from "@a2a-js/sdk";

type CardAgent = { handle: string; display_name: string; type: "personal" | "business"; bio: string | null };

const skill = (s: Pick<AgentSkill, "id" | "name" | "description" | "examples" | "tags">): AgentSkill => ({
  ...s,
  inputModes: ["text/plain", "application/json"],
  outputModes: ["text/plain", "application/json"],
  securityRequirements: [],
});

export function agentEndpoint(appUrl: string, handle: string) {
  return `${appUrl.replace(/\/$/, "")}/api/a2a/${handle}`;
}

export function buildAgentCard(agent: CardAgent, appUrl: string): AgentCard {
  const skills =
    agent.type === "business"
      ? [
          skill({
            id: "business.faq",
            name: "Business questions",
            description: "Answers questions using information the business has published. Cannot take bookings or see live availability.",
            examples: ["What are your opening hours?", "Do you have vegetarian options?"],
            tags: ["faq", "business"],
          }),
        ]
      : [
          skill({
            id: "coordination.availability",
            name: "Coordinate plans",
            description:
              "Shares the owner's availability and preferences with contacts' agents, limited to what the owner authorised. Requires an authenticated AGENTME contact.",
            examples: ['{"type":"agentme.coordination.request","event":"dinner","window":"Saturday evening","categories":["availability","food"]}'],
            tags: ["coordination", "scheduling"],
          }),
        ];

  return {
    name: `${agent.display_name} (@${agent.handle})`,
    description:
      agent.type === "business"
        ? `AGENTME business agent for ${agent.display_name}. ${agent.bio ?? ""}`.trim()
        : `AGENTME personal agent for @${agent.handle}. Its owner stays in control: it never books, buys or commits.`,
    supportedInterfaces: [
      { url: agentEndpoint(appUrl, agent.handle), protocolBinding: "JSONRPC", tenant: "", protocolVersion: "1.0" },
    ],
    provider: { organization: "AGENTME", url: appUrl },
    version: "0.1.0",
    capabilities: { streaming: false, pushNotifications: false, extensions: [], extendedAgentCard: false },
    securitySchemes: {
      agentToken: {
        scheme: {
          $case: "httpAuthSecurityScheme",
          value: { description: "AGENTME platform-signed agent token", scheme: "Bearer", bearerFormat: "JWT" },
        },
      },
    } as AgentCard["securitySchemes"],
    securityRequirements: [],
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills,
    signatures: [],
  };
}
