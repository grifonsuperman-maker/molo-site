const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../src/guest/services/contactValidation.ts'), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const exportsObject = {};
new Function('exports', javascript)(exportsObject);
const { normalizeGuestPhone, normalizeGuestName, isValidGuestName, formatGuestPhoneInput, phoneCaretPosition, editGuestPhoneInput } = exportsObject;

test('phone input formats typing and paste without changing subscriber digits', () => {
  assert.equal(formatGuestPhoneInput(''), '');
  assert.equal(formatGuestPhoneInput('+380'), '+380');
  assert.equal(formatGuestPhoneInput('+3805'), '+380 (5');
  assert.equal(formatGuestPhoneInput('+38050'), '+380 (50)');
  assert.equal(formatGuestPhoneInput('+380501'), '+380 (50) 1');
  for (const input of ['0501234567', '380501234567', '+380501234567', '501234567', '(050) 123-45-67', '+380 (50) 123-45-67']) {
    assert.equal(formatGuestPhoneInput(input), '+380 (50) 123-45-67');
    assert.equal(normalizeGuestPhone(formatGuestPhoneInput(input)), '+380501234567');
  }
  let value = '+380';
  for (const digit of '501234567') value = formatGuestPhoneInput(value + digit);
  assert.equal(value, '+380 (50) 123-45-67');
});

test('invalid paste and extra digits stay invalid instead of silently turning into another valid phone', () => {
  for (const input of ['+3805012345678', '05012345678', '+48501234567', '+380501234567abc', '+380501234567 доб. 1', '+380501234567🙂']) {
    assert.equal(formatGuestPhoneInput(input), input);
    assert.equal(normalizeGuestPhone(formatGuestPhoneInput(input)), null);
  }
  for (const input of ['', '+380', '+380 (50)', '+380000000000', '123', '050123456']) assert.equal(normalizeGuestPhone(input), null);
});

test('formatting preserves caret position while editing the beginning and middle of a number', () => {
  assert.equal(phoneCaretPosition('0501234567', '+380 (50) 123-45-67', 10), 19);
  assert.equal(phoneCaretPosition('+380501', '+380 (50) 1', 7), 11);
  assert.equal(phoneCaretPosition('+380 (5)', '+380 (5', 7), 7);
  assert.equal(phoneCaretPosition('+380 (50) 12-45-67', '+380 (50) 124-56-7', 12), 12);
});

test('mobile deletion removes a digit at mask boundaries instead of trapping the caret', () => {
  assert.deepEqual(editGuestPhoneInput('+380 (50', '+380 (50)', 8, 'deleteContentBackward'), { value: '+380 (5', caret: 7 });
  assert.deepEqual(editGuestPhoneInput('+380 (50) 12345-67', '+380 (50) 123-45-67', 13, 'deleteContentBackward'), { value: '+380 (50) 124-56-7', caret: 12 });
  assert.deepEqual(editGuestPhoneInput('+380 (50) 12345-67', '+380 (50) 123-45-67', 13, 'deleteContentForward'), { value: '+380 (50) 123-56-7', caret: 13 });
  assert.deepEqual(editGuestPhoneInput('+380 (50) 123-45-6', '+380 (50) 123-45-67', 18, 'deleteContentBackward'), { value: '+380 (50) 123-45-6', caret: 18 });
});

test('name validation allows letters and word spaces, rejecting digits and other characters', () => {
  for (const name of ['Олена', 'Олена Коваль', 'Ілля Євген Ґалаґан', 'Саня', 'Anne Marie', 'José', 'Jose\u0301', '李 明', 'А'.repeat(100)]) assert.equal(isValidGuestName(name), true, name);
  for (const name of ['', '   ', 'Олена123', '123', '🙂', '<script>', 'Олена_Коваль', 'Анна-Марія', 'Мар’яна', 'Олена\nКоваль', 'Олена\tКоваль', 'А'.repeat(101)]) assert.equal(isValidGuestName(name), false, name);
  assert.equal(normalizeGuestName('  Олена   Коваль  '), 'Олена Коваль');
  assert.equal(normalizeGuestName('Jose\u0301'), 'José');
});

function loadSubmit(relativePath, name, context) {
  const filename = path.resolve(__dirname, relativePath);
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) body = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(body, `Missing production handler ${name}`);
  const code = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const bindings = { ...exportsObject, ...context };
  return new Function(...Object.keys(bindings), `${code}\nreturn ${name};`)(...Object.values(bindings));
}

test('guest submit refuses an empty/invalid phone or invalid name before availability or booking requests', async () => {
  for (const [fullName, phone] of [['Олена', ''], ['Олена', '+380'], ['Олена', '+3805012345678'], ['Олена123', '+380501234567']]) {
    let requests = 0;
    let touched;
    const submit = loadSubmit('../src/guest/GuestApp.tsx', 'submit', {
      selectedTable: { id: 'table-1' }, form: { fullName, phone },
      setContactTouched(value) { touched = value; }, document: { getElementById() { return null; } },
      revalidateSelectedTableBeforeSubmit() { requests += 1; },
      bookingsApi: { create() { requests += 1; } },
    });
    await submit();
    assert.equal(requests, 0);
    assert.deepEqual(touched, { fullName: true, phone: true });
  }
});

test('manual submit sends no phone when blank or untouched prefix, accepts a full phone and rejects partial input', async () => {
  for (const manualPhone of ['', '+380', '+380 (50) 123-45-67', '+380 (50)']) {
    const sent = [];
    const errors = [];
    const submit = loadSubmit('../src/admin/AdminVisualTablePlanner.tsx', 'createManualBooking', {
      selectedTable: { id: 'table-1' }, manualFullName: '  Олена   Коваль  ', manualPhone,
      hasManualPhone: Boolean(manualPhone && manualPhone !== '+380'),
      manualGuestsCount: '2', manualDurationMinutes: '120', manualDate: '2026-09-20', manualTime: '18:00', manualWishes: '',
      setContactTouched() {}, setBusy() {}, setNotice() {}, setManualBookingOpen() {}, async load() {},
      setError(error) { errors.push(error); }, document: { getElementById() { return null; } },
      bookingsApi: { async createManual(payload) { sent.push(payload); } },
    });
    await submit();
    if (manualPhone === '+380 (50)') {
      assert.equal(sent.length, 0);
      assert.ok(errors.includes(exportsObject.GUEST_PHONE_ERROR));
    } else {
      assert.equal(sent.length, 1);
      assert.equal(sent[0].fullName, 'Олена Коваль');
      if (!manualPhone || manualPhone === '+380') assert.equal('phone' in sent[0], false);
      else assert.equal(sent[0].phone, '+380501234567');
    }
  }
});
