/** Byte size for the payload previews — bytes below 1 KB, one decimal above. */
export const formatSize = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

const pad2 = (value: number): string => String(value).padStart(2, '0');

/**
 * Wall-clock time for a call, in the viewer's own timezone.
 *
 * The list shows relative ages ("3s") because that reads best for what just happened, but once
 * you're reconciling the panel against a server log or a screen recording you need the actual clock
 * — so this backs the rows' hover title rather than replacing them.
 */
export const formatClockTime = (timestamp: number): string => {
  const at = new Date(timestamp);
  return `${pad2(at.getHours())}:${pad2(at.getMinutes())}:${pad2(at.getSeconds())}`;
};

/**
 * Compact "how long ago" label for activity rows and connection uptime.
 *
 * `now` is a parameter rather than a call to `Date.now()` so the function stays pure: the ticking
 * clock lives in a composable, and the formatting can be tested without faking timers. Timestamps
 * in the future clamp to `now` instead of rendering a negative age.
 */
export const formatRelativeTime = (timestamp: number, now: number): string => {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 1) return 'now';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
};
