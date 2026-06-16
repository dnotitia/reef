const ENCODED_CONTROL_CHARS = /%(?:0[\da-f]|1[\da-f]|7f)/i;

export function isSafeSameOriginPath(value: string | null): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !hasControlChar(value) &&
    !ENCODED_CONTROL_CHARS.test(value)
  );
}

function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);
    if (charCode <= 0x1f || charCode === 0x7f) return true;
  }
  return false;
}

export function normalizeSafeRedirect(value: string | null): string {
  return isSafeSameOriginPath(value) ? value : "/";
}

export function buildPathWithParams(
  pathname: string,
  params: Record<string, string>,
): string {
  const searchParams = new URLSearchParams(params);
  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}
