"use client";

import { useState, type ReactNode } from "react";
import { AutoGrowTextarea } from "./AutoGrowTextarea";

/**
 * A text box with its label and a live counter on the label line ("112 / 1,000"), like the Name
 * field. It stops at its limit. A value saved before a limit existed may start above it: the
 * counter then shows by how much (amber) and the text can only be shortened.
 */
export function CountedField({
  id,
  name = id,
  label,
  note,
  max,
  multiline = true,
  minRows = 2,
  maxRows = 6,
  defaultValue = "",
  value: controlled,
  onChange,
  placeholder,
}: {
  id: string;
  name?: string;
  label: ReactNode;
  /** After the label, muted: "· public", "· required". */
  note?: ReactNode;
  max: number;
  /** false: a one-line box. */
  multiline?: boolean;
  minRows?: number;
  maxRows?: number;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
}) {
  const [own, setOwn] = useState(defaultValue);
  const value = controlled ?? own;
  const set = (next: string) => (onChange ? onChange(next) : setOwn(next));
  const near = value.length >= max * 0.95;
  const props = { id, name, value, maxLength: Math.max(max, value.length), placeholder, className: "input", "aria-describedby": `${id}-counter` };
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="label" htmlFor={id}>
          {label}
          {note && <> <span className="font-normal text-muted">{note}</span></>}
        </label>
        <span id={`${id}-counter`} className={`text-xs tabular-nums ${near ? "text-amber-600 dark:text-amber-400" : "text-muted"}`} data-testid={`${id}-counter`} aria-live="polite">
          {value.length.toLocaleString("en-GB")} / {max.toLocaleString("en-GB")}
        </span>
      </div>
      {multiline ? (
        // Never grows past the limit; above it (old text), only shortening is possible.
        <AutoGrowTextarea {...props} minRows={minRows} maxRows={maxRows} onChange={(e) => set(e.target.value.length > max && e.target.value.length >= value.length ? value : e.target.value)} />
      ) : (
        <input {...props} onChange={(e) => set(e.target.value.length > max && e.target.value.length >= value.length ? value : e.target.value)} />
      )}
    </div>
  );
}
