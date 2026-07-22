export function formatMysqlTimestamp(date: Date = new Date()): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}
