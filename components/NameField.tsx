"use client";

import { useState } from "react";

/** A required name with a live "12 / 40" counter (amber near the limit; typing stops at it). */
export function NameField({
  id,
  name,
  label,
  max,
  defaultValue = "",
  placeholder,
  disabled,
}: {
  id: string;
  name: string;
  label: string;
  max: number;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(defaultValue.slice(0, max));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="label" htmlFor={id}>
          {label} <span className="font-normal text-muted">· required</span>
        </label>
        <span className={`text-xs tabular-nums ${value.length >= max - 5 ? "text-amber-600 dark:text-amber-400" : "text-muted"}`} data-testid={`${id}-counter`} aria-live="polite">
          {value.length} / {max}
        </span>
      </div>
      <input
        className="input"
        id={id}
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, max))}
        maxLength={max}
        required
        disabled={disabled}
        placeholder={placeholder}
      />
    </div>
  );
}
