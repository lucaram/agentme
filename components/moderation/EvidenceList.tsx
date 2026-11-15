import { LocalTime } from "@/components/LocalTime";
import type { Evidence } from "@/lib/moderation/types";

export function EvidenceList({ messages }: { messages: Evidence[] }) {
  return <div className="space-y-2">{messages.map((message) => <blockquote key={message.id} className="rounded-xl border-l-2 border-accent bg-accent-soft p-3" data-testid="report-evidence"><p className="text-xs text-muted">{message.author}{message.ai && " · AI"} · <LocalTime iso={message.at} full /></p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{message.content}</p></blockquote>)}</div>;
}
