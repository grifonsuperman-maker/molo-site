export const GUEST_NAME_PATTERN = /^\p{L}+(?: \p{L}+)*$/u;

const PHONE_INPUT_PATTERN = /^[+\d\s()-]+$/;

export function normalizeGuestName(value: string): string {
  return String(value || '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeGuestNameInput(value: string): string {
  return String(value || '')
    .normalize('NFC')
    .replace(/[^\p{L}\s]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 120);
}

export function isValidGuestName(value: string): boolean {
  const normalized = normalizeGuestName(value);
  return normalized.length > 0 && normalized.length <= 120 && GUEST_NAME_PATTERN.test(normalized);
}

export function normalizeUkrainePhone(value: string): string | null {
  const input = String(value || '').trim();
  if (!input || !PHONE_INPUT_PATTERN.test(input)) return null;

  const digits = input.replace(/\D/g, '');
  const normalizedDigits = digits.length === 10 && digits.startsWith('0')
    ? `38${digits}`
    : digits;

  if (!/^380[1-9]\d{8}$/.test(normalizedDigits)) return null;
  return `+${normalizedDigits}`;
}

export function formatUkrainePhoneInput(value: string): string {
  const input = String(value || '');
  if (!input) return '';

  const trimmed = input.trim();
  if (trimmed.startsWith('+') && !trimmed.startsWith('+380')) {
    return input.slice(0, 19);
  }

  const digits = input.replace(/\D/g, '');
  let nationalDigits = digits;

  if (digits.startsWith('380')) nationalDigits = digits.slice(3);
  else if (digits.startsWith('0')) nationalDigits = digits.slice(1);

  nationalDigits = nationalDigits.slice(0, 9);

  if (!nationalDigits) return '+380';

  let result = `+380 (${nationalDigits.slice(0, 2)}`;
  if (nationalDigits.length >= 2) result += ')';
  if (nationalDigits.length > 2) result += ` ${nationalDigits.slice(2, 5)}`;
  if (nationalDigits.length > 5) result += `-${nationalDigits.slice(5, 7)}`;
  if (nationalDigits.length > 7) result += `-${nationalDigits.slice(7, 9)}`;
  return result;
}
