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

assert(isValidGuestName('Анна Марія'), 'name with space should be valid');
assert(isValidGuestName('Анна-Марія'), 'name with hyphen should be valid');
assert(isValidGuestName('О’Браєн'), 'name with apostrophe should be valid');
assert(!isValidGuestName('Анна123'), 'digits in guest name must be rejected');
assert(normalizeGuestName('  Анна   Марія  ') === 'Анна Марія', 'name whitespace should normalize');
assert(sanitizeGuestNameInput('Анна123!') === 'Анна', 'name input should remove non-name characters');
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

console.log('guest contact validation passed');
