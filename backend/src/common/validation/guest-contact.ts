import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength } from 'class-validator';

export const GUEST_NAME_ERROR = 'Ім’я має містити лише літери та пробіли між словами (до 100 символів)';
export const GUEST_PHONE_ERROR = 'Введіть повний номер у форматі +380 (XX) XXX-XX-XX';
const GUEST_NAME_PATTERN = /^\p{L}[\p{L}\p{M}]*(?: \p{L}[\p{L}\p{M}]*)*$/u;

export function normalizeGuestName(value: string): string {
  return value.normalize('NFC').trim().replace(/ +/g, ' ');
}

export function normalizeGuestPhone(value: string): string | null {
  const input = value.trim();
  if (!/^\+?[0-9 ()-]+$/.test(input)) return null;
  let digits = input.replace(/\D/g, '');
  if (!input.startsWith('+') && /^0[1-9]\d{8}$/.test(digits)) digits = `38${digits}`;
  return /^380[1-9]\d{8}$/.test(digits) ? `+${digits}` : null;
}

export function GuestName() {
  return applyDecorators(
    Transform(({ value }) => typeof value === 'string' ? normalizeGuestName(value) : value, { toClassOnly: true }),
    IsString({ message: GUEST_NAME_ERROR }),
    Matches(GUEST_NAME_PATTERN, { message: GUEST_NAME_ERROR }),
    MaxLength(100, { message: GUEST_NAME_ERROR }),
  );
}

export function GuestPhone(optional = false) {
  return applyDecorators(
    Transform(({ value }) => {
      if (typeof value !== 'string') return value;
      if (optional && !value.trim()) return undefined;
      return normalizeGuestPhone(value) ?? value;
    }, { toClassOnly: true }),
    IsString({ message: GUEST_PHONE_ERROR }),
    Matches(/^\+380[1-9]\d{8}$/, { message: GUEST_PHONE_ERROR }),
  );
}
