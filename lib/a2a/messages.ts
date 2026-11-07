import { Role, type Message, type Part, type Task } from "@a2a-js/sdk";

export function textPart(text: string): Part {
  return { content: { $case: "text", value: text }, metadata: undefined, filename: "", mediaType: "text/plain" };
}

export function dataPart(value: Record<string, unknown>): Part {
  return { content: { $case: "data", value }, metadata: undefined, filename: "", mediaType: "application/json" };
}

export function buildMessage(opts: {
  role: "user" | "agent";
  parts: Part[];
  contextId?: string;
  taskId?: string;
}): Message {
  return {
    messageId: crypto.randomUUID(),
    contextId: opts.contextId ?? "",
    taskId: opts.taskId ?? "",
    role: opts.role === "user" ? Role.ROLE_USER : Role.ROLE_AGENT,
    parts: opts.parts,
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };
}

export type ExtractedContent = { text: string; data: Record<string, unknown> | null };

export function extractContent(parts: readonly Part[] | undefined): ExtractedContent {
  const texts: string[] = [];
  let data: Record<string, unknown> | null = null;
  for (const part of parts ?? []) {
    if (part.content?.$case === "text") texts.push(part.content.value);
    if (part.content?.$case === "data" && data === null && isRecord(part.content.value)) data = part.content.value;
  }
  return { text: texts.join("\n").trim(), data };
}

/** Pull the reply text/data out of whatever an A2A agent returned. */
export function extractResult(result: Message | Task): ExtractedContent & { state: string; taskId: string | null } {
  if ("parts" in result) return { ...extractContent(result.parts), state: "message", taskId: null };
  const statusContent = extractContent(result.status?.message?.parts);
  const artifactContent = extractContent(result.artifacts.flatMap((a) => a.parts));
  return {
    text: statusContent.text || artifactContent.text,
    data: artifactContent.data ?? statusContent.data,
    state: String(result.status?.state ?? "unknown"),
    taskId: result.id,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
