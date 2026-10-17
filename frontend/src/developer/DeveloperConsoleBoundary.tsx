import { Component, type ReactNode } from 'react';

export default class DeveloperConsoleBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="min-h-screen bg-[#10100f] p-8 text-white">
        <h1 className="text-xl font-semibold">Не вдалося завантажити пульт</h1>
        <p className="mt-3 text-white/70">Перевірте з’єднання та оновіть сторінку.</p>
        <button
          type="button"
          className="mt-6 rounded-xl bg-white px-5 py-3 font-medium text-black"
          onClick={() => window.location.reload()}
        >
          Оновити сторінку
        </button>
      </main>
    );
  }
}
