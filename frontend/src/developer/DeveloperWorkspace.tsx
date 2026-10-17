import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { DeveloperApiError, developerConsoleApi } from './developerConsoleApi';
import type { DeveloperLogin } from './developerConsoleApi';

const inputClass = 'w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-white outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 disabled:opacity-60';
const buttonClass = 'rounded-xl bg-cyan-300 px-5 py-3 font-semibold text-neutral-950 transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-60';

export default function DeveloperWorkspace() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState<DeveloperLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => () => { activeRequest.current?.abort(); activeRequest.current = null; }, []);
  useEffect(() => {
    if (!session) return;
    function expire() {
      if (Date.parse(session.sessionExpiresAt) <= Date.now()) {
        activeRequest.current?.abort();
        setSession(null); setBusy(false);
        setMessage('Сеанс завершено. Увійдіть знову.');
      }
    }
    const timeout = window.setTimeout(expire, Math.max(0, Date.parse(session.sessionExpiresAt) - Date.now()));
    window.addEventListener('focus', expire);
    document.addEventListener('visibilitychange', expire);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('focus', expire);
      document.removeEventListener('visibilitychange', expire);
    };
  }, [session]);

  async function runRequest(action: (signal: AbortSignal) => Promise<void>) {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    setBusy(true); setMessage('');
    try { await action(controller.signal); }
    catch (error) {
      if (activeRequest.current !== controller || (controller.signal.aborted && !timedOut)) return;
      if (error instanceof DeveloperApiError && [401, 403].includes(error.status)) setSession(null);
      setMessage(timedOut ? 'Сервер не відповів вчасно. Спробуйте ще раз.' :
        error instanceof DeveloperApiError ? error.message : 'Не вдалося виконати запит. Спробуйте ще раз.');
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) { activeRequest.current = null; setBusy(false); }
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    void runRequest(async (signal) => {
      const result = await developerConsoleApi.login(login.trim(), password, signal);
      if (!signal.aborted) { setSession(result); setPassword(''); }
    });
  }

  function checkSession() {
    if (!session || busy) return;
    const currentToken = session.accessToken;
    void runRequest(async (signal) => {
      const result = await developerConsoleApi.session(currentToken, signal);
      if (!signal.aborted) { setSession({ ...result, accessToken: currentToken }); setMessage('Доступ підтверджено.'); }
    });
  }

  function logout() {
    activeRequest.current?.abort(); activeRequest.current = null;
    setSession(null); setPassword(''); setMessage(''); setBusy(false);
  }

  return (
    <main className="min-h-screen bg-[#10100f] px-4 py-8 text-white sm:py-14">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center justify-between gap-4 border-b border-neutral-800 pb-6">
          <div>
            <p className="mb-2 text-xs font-semibold tracking-[0.3em] text-cyan-300">MOLO</p>
            <h1 className="text-2xl font-semibold sm:text-3xl">Пульт розробника</h1>
          </div>
          <a className="shrink-0 rounded-xl border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:text-white" href="/">До сайту</a>
        </header>

        {message && <p role="status" aria-live="polite" className="mb-6 rounded-xl border border-cyan-400/30 bg-cyan-950/30 px-4 py-3 text-sm text-cyan-100">{message}</p>}

        {!session ? (
          <section className="mx-auto max-w-md rounded-2xl border border-neutral-800 bg-neutral-950 p-6 sm:p-8">
            <h2 className="mb-2 text-xl font-semibold">Окремий вхід</h2>
            <p className="mb-6 text-sm leading-6 text-neutral-400">Увійдіть за допомогою облікових даних розробника.</p>
            <form onSubmit={submit} className="space-y-5">
              <div>
                <label htmlFor="developer-login" className="mb-2 block text-sm text-neutral-300">Логін</label>
                <input id="developer-login" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
                  required minLength={3} maxLength={64} disabled={busy} className={inputClass}
                  value={login} onChange={(event) => setLogin(event.target.value)} />
              </div>
              <div>
                <label htmlFor="developer-password" className="mb-2 block text-sm text-neutral-300">Пароль</label>
                <input id="developer-password" name="password" type="password" autoComplete="current-password"
                  required minLength={16} maxLength={72} disabled={busy} className={inputClass}
                  value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
              <button type="submit" disabled={busy} className={`${buttonClass} w-full`}>{busy ? 'Перевіряємо…' : 'Увійти'}</button>
            </form>
          </section>
        ) : (
          <section aria-label="Пульт розробника">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <h2 className="text-xl font-semibold">Доступ підтверджено</h2>
              </div>
              <button type="button" onClick={logout} className="rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800">Вийти</button>
            </div>
            <dl className="mb-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
                <dt className="mb-2 text-sm text-neutral-400">Роль</dt>
                <dd className="font-semibold">Розробник</dd>
              </div>
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
                <dt className="mb-2 text-sm text-neutral-400">Версія сервера</dt>
                <dd className="font-mono font-semibold">{session.version || 'Не визначено'}</dd>
              </div>
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
                <dt className="mb-2 text-sm text-neutral-400">Сеанс діє до</dt>
                <dd className="font-semibold">{new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' }).format(new Date(session.sessionExpiresAt))}</dd>
              </div>
            </dl>
            <button type="button" onClick={checkSession} disabled={busy} className={buttonClass}>{busy ? 'Перевіряємо…' : 'Перевірити доступ'}</button>
          </section>
        )}
      </div>
    </main>
  );
}
