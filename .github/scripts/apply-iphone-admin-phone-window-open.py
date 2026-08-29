from pathlib import Path

path = Path('frontend/src/guest/GuestApp.tsx')
source = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    source = source.replace(old, new, 1)


replace_once(
    """  function callAdmin() {
    alert('Телефон адміністратора ще не додано.');
  }
""",
    """  function callAdmin() {
    if (adminPhone) {
      window.open(`tel:${adminPhone}`, '_blank');
      return;
    }

    alert('Телефон адміністратора ще не додано.');
  }
""",
    'callAdmin',
)

replace_once(
    """            {pendingTooLong && (
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
            )}
""",
    """            {pendingTooLong && (
              <button
                type=\"button\"
                onClick={callAdmin}
                className=\"mt-3 w-full rounded-2xl border border-amber-200/60 bg-amber-300/20 px-4 py-3 text-sm font-black text-amber-100 transition active:scale-[0.98]\"
              >
                Зателефонувати Адміністратору
              </button>
            )}
""",
    'pending call button',
)

replace_once(
    """                {adminPhone ? (
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
                )}
""",
    """                <button
                  type=\"button\"
                  onClick={callAdmin}
                  className=\"molo-button inline-flex items-center justify-center gap-4 rounded-[26px] border border-amber-200/95 bg-black/10 px-6 py-5 text-xl font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.12)] backdrop-blur-sm sm:text-2xl\"
                >
                  <Phone className=\"h-7 w-7 text-amber-200\" />
                  Зателефонувати адміністратору
                </button>
""",
    'home call button',
)

replace_once(
    """                  {adminPhone ? (
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
                  )}
""",
    """                  <button
                    type=\"button\"
                    onClick={callAdmin}
                    className=\"mt-4 rounded-2xl border border-amber-200/60 bg-amber-300/20 px-5 py-3 text-sm font-bold text-amber-100 transition active:scale-95\"
                  >
                    Зателефонувати Адміністратору
                  </button>
""",
    'success call button',
)

if source.count('onClick={callAdmin}') != 3:
    raise SystemExit('expected exactly three admin call click handlers')
if 'href={`tel:' in source:
    raise SystemExit('native tel anchor still present')
if source.count("window.open(`tel:${adminPhone}`, '_blank');") != 1:
    raise SystemExit('expected exactly one Telegram iPhone window.open workaround')
if 'window.location.href = `tel:' in source:
    raise SystemExit('old window.location tel navigation still present')

path.write_text(source)
