from pathlib import Path
from textwrap import dedent


guest_path = Path('frontend/src/guest/GuestApp.tsx')
source = guest_path.read_text()


def replace_once(old: str, new: str, label: str):
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    source = source.replace(old, new, 1)


replace_once(
    """const pendingTooLong =
    bookingStatus?.status === 'pending' &&
    (bookingStatus.isPendingTooLong || bookingStatus.pendingAgeMinutes >= 15);
  const activeBookingStatusText = !bookingStatus""",
    """const pendingTooLong =
    bookingStatus?.status === 'pending' &&
    (bookingStatus.isPendingTooLong || bookingStatus.pendingAgeMinutes >= 15);
  const adminPhone = bookingStatus?.restaurantPhone || restaurant?.phone;
  const activeBookingStatusText = !bookingStatus""",
    'adminPhone value',
)

replace_once(
    """function callAdmin() {
    const phone = bookingStatus?.restaurantPhone || restaurant?.phone;

    if (phone) {
      window.location.href = `tel:${phone}`;
      return;
    }

    alert('Телефон адміністратора ще не додано.');
  }""",
    """function callAdmin() {
    alert('Телефон адміністратора ще не додано.');
  }""",
    'callAdmin fallback',
)

replace_once(
    """{pendingTooLong && (
              <button
                type=\"button\"
                onClick={callAdmin}
                className=\"mt-3 w-full rounded-2xl border border-amber-200/60 bg-amber-300/20 px-4 py-3 text-sm font-black text-amber-100 transition active:scale-[0.98]\"
              >
                Зателефонувати Адміністратору
              </button>
            )}""",
    """{pendingTooLong && (
              adminPhone ? (
                <a
                  href={`tel:${adminPhone}`}
                  className=\"mt-3 block w-full rounded-2xl border border-amber-200/60 bg-amber-300/20 px-4 py-3 text-center text-sm font-black text-amber-100 transition active:scale-[0.98]\"
                >
                  Зателефонувати Адміністратору
                </a>
              ) : (
                <button
                  type=\"button\"
                  onClick={callAdmin}
                  className=\"mt-3 w-full rounded-2xl border border-amber-200/60 bg-amber-300/20 px-4 py-3 text-sm font-black text-amber-100 transition active:scale-[0.98]\"
                >
                  Зателефонувати Адміністратору
                </button>
              )
            )}""",
    'top pending admin call',
)

replace_once(
    """<button
                  onClick={callAdmin}
                  className=\"molo-button inline-flex items-center justify-center gap-4 rounded-[26px] border border-amber-200/95 bg-black/10 px-6 py-5 text-xl font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.12)] backdrop-blur-sm sm:text-2xl\"
                >
                  <Phone className=\"h-7 w-7 text-amber-200\" />
                  Зателефонувати адміністратору
                </button>""",
    """{adminPhone ? (
                  <a
                    href={`tel:${adminPhone}`}
                    className=\"molo-button inline-flex items-center justify-center gap-4 rounded-[26px] border border-amber-200/95 bg-black/10 px-6 py-5 text-xl font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.12)] backdrop-blur-sm sm:text-2xl\"
                  >
                    <Phone className=\"h-7 w-7 text-amber-200\" />
                    Зателефонувати адміністратору
                  </a>
                ) : (
                  <button
                    type=\"button\"
                    onClick={callAdmin}
                    className=\"molo-button inline-flex items-center justify-center gap-4 rounded-[26px] border border-amber-200/95 bg-black/10 px-6 py-5 text-xl font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.12)] backdrop-blur-sm sm:text-2xl\"
                  >
                    <Phone className=\"h-7 w-7 text-amber-200\" />
                    Зателефонувати адміністратору
                  </button>
                )}""",
    'home admin call',
)

replace_once(
    """<button
                    type=\"button\"
                    onClick={callAdmin}
                    className=\"mt-4 rounded-2xl border border-amber-200/60 bg-amber-300/20 px-5 py-3 text-sm font-bold text-amber-100 transition active:scale-95\"
                  >
                    Зателефонувати Адміністратору
                  </button>""",
    """{adminPhone ? (
                    <a
                      href={`tel:${adminPhone}`}
                      className=\"mt-4 inline-block rounded-2xl border border-amber-200/60 bg-amber-300/20 px-5 py-3 text-sm font-bold text-amber-100 transition active:scale-95\"
                    >
                      Зателефонувати Адміністратору
                    </a>
                  ) : (
                    <button
                      type=\"button\"
                      onClick={callAdmin}
                      className=\"mt-4 rounded-2xl border border-amber-200/60 bg-amber-300/20 px-5 py-3 text-sm font-bold text-amber-100 transition active:scale-95\"
                    >
                      Зателефонувати Адміністратору
                    </button>
                  )}""",
    'success pending admin call',
)

if 'window.location.href = `tel:' in source:
    raise SystemExit('old JavaScript tel navigation still present')
if source.count('href={`tel:${adminPhone}`}') != 3:
    raise SystemExit('expected exactly three native admin tel anchors')
if source.count('onClick={callAdmin}') != 3:
    raise SystemExit('expected exactly three missing-phone fallback buttons')

guest_path.write_text(source)

test_path = Path('frontend/test/iphone-admin-phone-link.test.cjs')
test_path.write_text(dedent("""
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    const test = require('node:test');

    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'guest', 'GuestApp.tsx'),
      'utf8',
    );

    test('guest admin call controls use native tel links for iPhone-compatible navigation', () => {
      assert.match(
        source,
        /const adminPhone = bookingStatus\?\.restaurantPhone \|\| restaurant\?\.phone;/,
        'admin phone priority must remain booking response first, restaurant settings second',
      );
      assert.equal(
        (source.match(/href=\{`tel:\$\{adminPhone\}`\}/g) || []).length,
        3,
        'all three admin call controls must render native tel anchors when a phone exists',
      );
      assert.equal(
        (source.match(/onClick=\{callAdmin\}/g) || []).length,
        3,
        'all three call locations must keep the missing-phone button fallback',
      );
      assert.doesNotMatch(source, /window\.location\.href\s*=\s*`tel:/);
      assert.match(source, /alert\('Телефон адміністратора ще не додано\.'\);/);
    });
""").lstrip())

package_path = Path('frontend/package.json')
package_source = package_path.read_text()
old = 'node test/guest-reschedule-decision.test.cjs\", \"preview\"'
new = 'node test/guest-reschedule-decision.test.cjs && node test/iphone-admin-phone-link.test.cjs\", \"preview\"'
if package_source.count(old) != 1:
    raise SystemExit(f'frontend package test hook: expected exactly 1 match, found {package_source.count(old)}')
package_path.write_text(package_source.replace(old, new, 1))
