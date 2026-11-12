export const DEFAULT_DOOM_VOLUME = 50;

export function volumeFromPercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return null;
  return value / 100;
}
