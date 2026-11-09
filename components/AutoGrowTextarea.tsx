"use client";

import { useCallback, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

/**
 * A text box that grows with what you type (Enter = new line), from `minRows`
 * up to `maxRows`, then scrolls. For anything written in sentences; short
 * values (names, emails, search) stay one-line inputs.
 */
export function AutoGrowTextarea({
  minRows = 1,
  maxRows = 6,
  className = "input",
  onInput,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; maxRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const css = getComputedStyle(el);
    const line = parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.5;
    const borders = parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);
    const padding = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
    const max = line * maxRows + padding + borders;
    el.style.height = "auto";
    const wanted = el.scrollHeight + borders;
    el.style.height = `${Math.min(wanted, max)}px`;
    el.style.overflowY = wanted > max ? "auto" : "hidden";
  }, [maxRows]);
  // Fit on first render (saved text) and whenever a controlled value changes.
  useLayoutEffect(fit, [fit, rest.value]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      className={`${className} thin-scrollbar resize-none`}
      onInput={(e) => {
        fit();
        onInput?.(e);
      }}
      {...rest}
    />
  );
}
