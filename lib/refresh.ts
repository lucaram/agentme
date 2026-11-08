/**
 * One shared, debounced page refresh for everything on screen (live updates,
 * "mark as read"…): several triggers at the same moment become a single
 * server render instead of one each.
 */
let timer: ReturnType<typeof setTimeout> | undefined;

export function scheduleRefresh(refresh: () => void, delayMs = 250) {
  clearTimeout(timer);
  timer = setTimeout(refresh, delayMs);
}
