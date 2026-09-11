export const GUEST_NAME_PATTERN = /^\p{L}+(?: \p{L}+)*$/u;
export const UKRAINE_PHONE_PATTERN = /^\+380[1-9]\d{8}$/;

const PHONE_INPUT_PATTERN = /^[+\d\s()-]+$/;

export function normalizeGuestName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFC')
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

  if (!/^380[1-9]\d{8}$/.test(normalizedDigits)) return null;
  return `+${normalizedDigits}`;
}

export function normalizeLegacyUkrainePhone(value: unknown): string | null {
  const input = String(value ?? '').trim();
  if (!input) return null;

  const digits = input.replace(/\D/g, '');
  let normalizedDigits = digits;

  if (/^[1-9]\d{8}$/.test(digits)) normalizedDigits = `380${digits}`;
  else if (/^0[1-9]\d{8}$/.test(digits)) normalizedDigits = `38${digits}`;

  if (!/^380[1-9]\d{8}$/.test(normalizedDigits)) return null;
  return `+${normalizedDigits}`;
}

export function ukrainePhoneDigitsVariants(value: unknown): string[] {
  const normalized = normalizeLegacyUkrainePhone(value);
  if (!normalized) return [];

  const full = normalized.slice(1);
  const subscriber = full.slice(3);
  return [full, `0${subscriber}`, subscriber];
}
