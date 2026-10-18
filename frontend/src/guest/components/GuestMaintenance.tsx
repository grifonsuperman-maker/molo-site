export default function GuestMaintenance() {
  return (
    <section
      aria-labelledby="molo-maintenance-title"
      className="relative grid min-h-screen min-h-[100svh] place-items-center bg-[#10100f] px-4 py-8 text-[#f7f1df]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_20%,#292315_0%,#10100f_54%,#080808_100%)]" aria-hidden="true" />
      <div className="relative w-full max-w-xl rounded-[28px] border border-[#6f6343] bg-gradient-to-br from-[#221e14] to-[#0d0d0c] px-6 py-12 text-center shadow-2xl sm:px-12">
        <p className="text-4xl font-bold tracking-[0.24em] text-[#e7d19a]">MOLO</p>
        <p className="mt-2 text-xs font-semibold tracking-[0.4em] text-[#a99a77]">RESTAURANT</p>
        <div className="mx-auto my-8 h-px w-16 bg-[#ad9561]" aria-hidden="true" />
        <h1 id="molo-maintenance-title" className="text-3xl font-bold leading-tight sm:text-4xl">
          Технічне обслуговування та оновлення версії
        </h1>
        <p className="mt-6 text-base leading-relaxed text-[#c9c3b7]">
          На сайті проводяться технічні роботи. Онлайн-сервіс тимчасово недоступний.
        </p>
        <div className="mt-7 rounded-2xl border border-[#53482f] bg-[#d2af6412] px-4 py-5">
          <p className="text-base">Сайт відновить роботу</p>
          <time dateTime="2026-11-05" className="mt-1 block text-3xl font-bold text-[#e7d19a]">
            05.11.2026
          </time>
        </div>
        <p className="mt-7 text-sm text-[#c2b9a5]">Дякуємо за розуміння!</p>
      </div>
    </section>
  );
}
