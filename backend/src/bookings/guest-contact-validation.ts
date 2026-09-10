export const GUEST_NAME_PATTERN = /^\p{L}+(?:[\s'’-]\p{L}+)*$/u;
export const UKRAINE_PHONE_PATTERN = /^\+380\d{9}$/;

const PHONE_INPUT_PATTERN = /^[+\d\s()-]+$/;

export function normalizeGuestName(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isValidGuestName(value: unknown): boolean {
  const normalized = normalizeGuestName(value);
  return normalized.length > 0 && normalized.length <= 120 && GUEST_NAME_PATTERN.test(normalized);
}

export function normalizeUkrainePhone(value: unknown): string | null {
  const input = String(value ?? '').trim();
  if (!input || !PHONE_INPUT_PATTERN.test(input)) return null;

  const digits = input.replace(/\D/g, '');
  const normalizedDigits = digits.length === 10 && digits.startsWith('0')
    ? `38${digits}`
    : digits;

  if (!/^380\d{9}$/.test(normalizedDigits)) return null;
  return `+${normalizedDigits}`;
}
