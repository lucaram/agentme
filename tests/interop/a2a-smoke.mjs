// Standalone A2A interoperability check: an EXTERNAL client (not AGENTME code)
// discovers an agent card and sends a message with the official SDK.
// Usage: node tests/interop/a2a-smoke.mjs [baseUrl]
import { ClientFactory } from "@a2a-js/sdk/client";
import { Role } from "@a2a-js/sdk";

const base = process.argv[2] ?? "http://localhost:3000";
const client = await new ClientFactory().createFromUrl(`${base}/api/a2a/trattoria/`);
const result = await client.sendMessage({
  tenant: "",
  message: {
    messageId: crypto.randomUUID(), contextId: "", taskId: "", role: Role.ROLE_USER,
    parts: [{ content: { $case: "text", value: "Do you have vegetarian options?" }, metadata: undefined, filename: "", mediaType: "text/plain" }],
    metadata: undefined, extensions: [], referenceTaskIds: [],
  },
  configuration: undefined,
  metadata: undefined,
});
const parts = "parts" in result ? result.parts : result.status?.message?.parts ?? [];
const text = parts.filter((p) => p.content?.$case === "text").map((p) => p.content.value).join(" ");
console.log(JSON.stringify({ state: result.status?.state ?? "message", text }));
if (!/vegetarian/i.test(text)) process.exit(1);
