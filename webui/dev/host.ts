export function spaceError(cause: unknown): string {
  if (cause && typeof cause === "object" && "message" in cause) return String((cause as { message: unknown }).message);
  return String(cause ?? "未知错误");
}
