"use client";

import { useState } from "react";

/** An optional input or textarea that stops at its limit and shows a counter only once it's nearly full (80%). */
export function LimitedField({
  name,
  max,
  multiline,
  rows = 2,
  value: controlled,
  onChange,
  className = "",
  ...rest
}: {
  name: string;
  max: number;
  multiline?: boolean;
  rows?: number;
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
  id?: string;
  placeholder?: string;
  required?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const [own, setOwn] = useState("");
  const value = controlled ?? own;
  const set = (v: string) => {
    const next = v.slice(0, max);
    if (onChange) onChange(next);
    else setOwn(next);
  };
  const near = value.length >= Math.floor(max * 0.8);
  const props = { ...rest, name, maxLength: max, value, className: `input ${className}`.trim() };
  return (
    <div>
      {multiline ? (
        <textarea {...props} rows={rows} onChange={(e) => set(e.target.value)} />
      ) : (
        <input {...props} onChange={(e) => set(e.target.value)} />
      )}
      {near && (
        <p className={`mt-1 text-right text-xs tabular-nums ${value.length >= max ? "text-amber-600 dark:text-amber-400" : "text-muted"}`} data-testid={`${name}-counter`} aria-live="polite">
          {value.length} / {max}
        </p>
      )}
    </div>
  );
}
