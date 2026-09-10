import {
  formatUkrainePhoneInput,
  isValidGuestName,
  normalizeGuestName,
  normalizeUkrainePhone,
  sanitizeGuestNameInput,
} from './guestContact.js';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(isValidGuestName('Анна Марія'), 'name with letters and spaces should be valid');
assert(!isValidGuestName('Анна-Марія'), 'hyphen in guest name must be rejected');
assert(!isValidGuestName('О’Браєн'), 'apostrophe in guest name must be rejected');
assert(!isValidGuestName('Анна123'), 'digits in guest name must be rejected');
assert(normalizeGuestName('  Анна   Марія  ') === 'Анна Марія', 'name whitespace should normalize');
assert(sanitizeGuestNameInput('Анна-123! Марія') === 'Анна Марія', 'name input should keep only letters and spaces');
assert(
  formatUkrainePhoneInput('0671234567') === '+380 (67) 123-45-67',
  'local Ukrainian phone should format to +380 mask',
);
assert(
  formatUkrainePhoneInput('+48 501 234 567') === '+48 501 234 567',
  'foreign country code must not be rewritten as +380',
);
assert(
  normalizeUkrainePhone('+380 (67) 123-45-67') === '+380671234567',
  'formatted Ukrainian phone should normalize',
);
assert(normalizeUkrainePhone('+380 (67) 123-45') === null, 'incomplete phone must be rejected');
assert(normalizeUkrainePhone('+48 501 234 567') === null, 'non-Ukrainian phone must be rejected');
assert(normalizeUkrainePhone('+380 (01) 123-45-67') === null, 'invalid Ukrainian national prefix must be rejected');

console.log('guest contact validation passed');
