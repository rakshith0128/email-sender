/** Shared date/text formatting so every view renders values identically. */

/**
 * Some locales render the meridiem lower-case ("1:23 pm"). The design uses
 * upper-case, so normalise just that token rather than pinning the whole
 * format to en-US, which would override the viewer's date conventions too.
 * Anchored to the end of the string so it can only ever match a real suffix.
 */
function upperMeridiem(value: string): string {
  return value.replace(/\b([ap])\.?\s?m\.?$/i, (match) => match.toUpperCase());
}

export function formatDateTime(value: string | Date | null): string {
  if (!value) return '-';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '-';

  return upperMeridiem(
    date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }),
  );
}

/**
 * The compact stamp shown in the list pill, matching the Figma format
 * ("Tue 9:15:12 AM"). Drops the weekday once the date is more than a week
 * away, where a weekday alone would be ambiguous.
 */
export function formatRowTime(value: string | Date | null): string {
  if (!value) return '-';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '-';

  const time = upperMeridiem(
    date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }),
  );

  const daysAway = Math.abs(date.getTime() - Date.now()) / 86_400_000;
  if (daysAway > 6) {
    return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
  }

  return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

/** "in 3m", "12s ago" - makes pending rows legible at a glance. */
export function formatRelative(value: string | Date | null): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';

  const deltaSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const future = deltaSeconds > 0;
  const seconds = Math.abs(deltaSeconds);

  const render = (amount: number, unit: string) =>
    future ? `in ${amount}${unit}` : `${amount}${unit} ago`;

  if (seconds < 60) return render(seconds, 's');
  if (seconds < 3600) return render(Math.round(seconds / 60), 'm');
  if (seconds < 86_400) return render(Math.round(seconds / 3600), 'h');
  return render(Math.round(seconds / 86_400), 'd');
}

/** Value for <input type="datetime-local"> - needs local time, not ISO/UTC. */
export function toDateTimeLocalValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/** Strips tags from an HTML fragment for single-line previews. */
export function plainTextPreview(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function initialsOf(value: string): string {
  const cleaned = value.trim();
  if (!cleaned) return '?';
  return cleaned[0]!.toUpperCase();
}
