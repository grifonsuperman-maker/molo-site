export const GUEST_NAME_ERROR = 'Ім’я має містити лише літери та пробіли між словами (до 100 символів)';
export const GUEST_PHONE_ERROR = 'Введіть повний номер у форматі +380 (XX) XXX-XX-XX';
const GUEST_NAME_PATTERN = /^\p{L}[\p{L}\p{M}]*(?: \p{L}[\p{L}\p{M}]*)*$/u;

export function normalizeGuestName(value: string): string {
  return value.normalize('NFC').trim().replace(/ +/g, ' ');
}

export function isValidGuestName(value: string): boolean {
  const name = normalizeGuestName(value);
  return Array.from(name).length <= 100 && GUEST_NAME_PATTERN.test(name);
}

export function normalizeGuestPhone(value: string): string | null {
  const input = value.trim();
  if (!/^\+?[0-9 ()-]+$/.test(input)) return null;
  let digits = input.replace(/\D/g, '');
  if (!input.startsWith('+') && /^0[1-9]\d{8}$/.test(digits)) digits = `38${digits}`;
  return /^380[1-9]\d{8}$/.test(digits) ? `+${digits}` : null;
}

// Keep invalid paste visible so a wrong country, extra digit or letter is never silently discarded.
export function formatGuestPhoneInput(value: string): string {
  const input = value.trim();
  if (!input) return '';
  if (!/^\+?[0-9 ()-]*$/.test(input)) return value;
  let digits = input.replace(/\D/g, '');
  if (input.startsWith('+')) {
    if ('380'.startsWith(digits)) return '+380';
    if (!digits.startsWith('380')) return value;
    digits = digits.slice(3);
  } else if (digits.startsWith('380')) {
    digits = digits.slice(3);
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (digits.length > 9) return value;
  if (!digits) return '+380';
  let result = `+380 (${digits.slice(0, 2)}`;
  if (digits.length >= 2) result += ')';
  if (digits.length > 2) result += ` ${digits.slice(2, 5)}`;
  if (digits.length > 5) result += `-${digits.slice(5, 7)}`;
  if (digits.length > 7) result += `-${digits.slice(7)}`;
  return result;
}

export function phoneCaretPosition(raw: string, formatted: string, caret: number): number {
  if (raw === formatted) return caret;
  const digitCount = (text: string) => text.replace(/\D/g, '').length;
  const target = digitCount(raw.slice(0, caret)) + digitCount(formatted) - digitCount(raw);
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (/\d/.test(formatted[index]) && ++seen >= target) return Math.max(4, index + 1);
  }
  return formatted.length;
}

export function editGuestPhoneInput(raw: string, previous: string, caret: number, inputType = '') {
  // Mobile keyboards may delete a separator without sending a Backspace/Delete key event.
  if (previous.startsWith('+380') && raw.length < previous.length &&
      raw.replace(/\D/g, '') === previous.replace(/\D/g, '') &&
      (inputType === 'deleteContentBackward' || inputType === 'deleteContentForward')) {
    const direction = inputType === 'deleteContentBackward' ? -1 : 1;
    let index = direction === -1 ? caret - 1 : caret;
    while (index >= 4 && index < raw.length && !/\d/.test(raw[index])) index += direction;
    if (index >= 4 && index < raw.length) {
      raw = raw.slice(0, index) + raw.slice(index + 1);
      if (direction === -1) caret = index;
    }
  }
  const value = formatGuestPhoneInput(raw);
  return { value, caret: phoneCaretPosition(raw, value, caret) };
}
