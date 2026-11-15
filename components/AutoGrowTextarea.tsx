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
    const min = line * minRows + padding + borders;
    const max = line * Math.max(minRows, maxRows) + padding + borders;
    // A closed dialog has no measurable scroll height. Keep the requested
    // minimum instead of collapsing to just its padding and borders.
    el.style.minHeight = `${min}px`;
    el.style.height = "auto";
    const wanted = Math.max(min, el.scrollHeight + borders);
    el.style.height = `${Math.min(wanted, max)}px`;
    el.style.overflowY = wanted > max ? "auto" : "hidden";
  }, [minRows, maxRows]);
  // Fit on first render (saved text) and whenever a controlled value changes.
  useLayoutEffect(fit, [fit, rest.value]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = 0;
    const observer = new ResizeObserver(([entry]) => {
      // Refit when a dialog/section becomes visible or wraps at a new width.
      // Ignore our own height changes to avoid a ResizeObserver feedback loop.
      if (entry.contentRect.width > 0 && entry.contentRect.width !== width) {
        width = entry.contentRect.width;
        fit();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);
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
