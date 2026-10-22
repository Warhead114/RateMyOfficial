const RATING_MIN = 1;
const RATING_MAX = 5;

export function isValidRating(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= RATING_MIN &&
    value <= RATING_MAX
  );
}

export function dateKeyInTimeZone(
  date: Date,
  timeZone = "America/New_York",
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isEventReviewable(
  eventDate: Date,
  now = new Date(),
  timeZone = "America/New_York",
): boolean {
  return dateKeyInTimeZone(eventDate, timeZone) <= dateKeyInTimeZone(now, timeZone);
}