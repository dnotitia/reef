export function buildCurrentDateContext(now = new Date()): {
  today: string;
  timeZone: string;
} {
  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone?.trim() || "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  return {
    today: `${lookup.get("year")}-${lookup.get("month")}-${lookup.get("day")}`,
    timeZone,
  };
}
