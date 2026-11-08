import { parseRichText, type Inline } from "@/lib/richtext";

function Spans({ content }: { content: Inline[] }) {
  return (
    <>
      {content.map((part, i) =>
        part.bold ? (
          <strong key={i} className="font-semibold">
            {part.text}
          </strong>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** Readable agent messages: a heading line, labelled bullet points, bold text. Rendered as elements, never raw HTML. */
export function RichText({ text }: { text: string }) {
  const blocks = parseRichText(text);
  return (
    <div className="space-y-2" data-testid="rich-text">
      {blocks.map((block, i) =>
        block.type === "paragraph" ? (
          <p key={i} className={i === 0 && blocks.length > 1 ? "font-medium" : undefined}>
            <Spans content={block.content} />
          </p>
        ) : (
          <ul key={i} className="space-y-2">
            {block.items.map((item, j) => (
              <li key={j} className="flex gap-2">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span className="min-w-0">
                  {item.label && (
                    <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-accent">{item.label}</span>
                  )}
                  <Spans content={item.content} />
                </span>
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

