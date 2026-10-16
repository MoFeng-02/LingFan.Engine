/**
 * 两轮求值的逐键比较：确定性闸门的判据。
 */
import type { JsonValue } from "../contracts.ts";

export function firstDeterminismDiff(
  a: Record<string, JsonValue>,
  b: Record<string, JsonValue>,
): string | null {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!deepEqual(a[key], b[key])) return key;
  }
  return null;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(
      (key) =>
        key in b &&
        deepEqual(
          (a as { [k: string]: JsonValue })[key],
          (b as { [k: string]: JsonValue })[key],
        ),
    );
  }
  return false;
}
