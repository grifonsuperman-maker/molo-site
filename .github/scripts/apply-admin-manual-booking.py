from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}")
    file.write_text(text.replace(old, new, 1))


# Backend DTO: manual admin booking reuses normal booking validation except guest-browser identity.
Path('backend/src/bookings/dto/create-admin-manual-booking.dto.ts').write_text("""import { OmitType } from '@nestjs/mapped-types';
import { IsNotEmpty, IsString } from 'class-validator';

import { CreateBookingDto } from './create-booking.dto';

export class CreateAdminManualBookingDto extends OmitType(CreateBookingDto, [
  'guestDeviceId',
  'tableId',
  'tableNumber',
  'seats',
] as const) {
  @IsString()
  @IsNotEmpty()
  tableId: string;
}
""")

# Lock and availability helpers only depend on slot fields; widen their types without changing runtime behavior.
replace_once(
    'backend/src/bookings/booking-table-lock.service.ts',
    "  async withCreateLock<T>(dto: CreateBookingDto, work: () => Promise<T>) {",
    "  async withCreateLock<T>(\n    dto: Pick<CreateBookingDto, 'tableId' | 'tableNumber' | 'bookingDate'>,\n    work: () => Promise<T>,\n  ) {",
)
replace_once(
    'backend/src/bookings/availability-blocks.service.ts',
    "  async assertBookable(dto: CreateBookingDto) {",
    "  async assertBookable(\n    dto: Pick<\n      CreateBookingDto,\n      'tableId' | 'tableNumber' | 'bookingDate' | 'bookingTime' | 'durationMinutes'\n    >,\n  ) {",
)

# Protected admin endpoint.
replace_once(
    'backend/src/bookings/bookings.controller.ts',
    "import { CheckAvailabilityDto } from './dto/check-availability.dto';\nimport { CreateBookingDto } from './dto/create-booking.dto';",
    "import { CheckAvailabilityDto } from './dto/check-availability.dto';\nimport { CreateAdminManualBookingDto } from './dto/create-admin-manual-booking.dto';\nimport { CreateBookingDto } from './dto/create-booking.dto';",
)
replace_once(
    'backend/src/bookings/bookings.controller.ts',
    "  @Public()\n  @Get('availability')",
    "  @Post('admin/manual')\n  @Roles('admin', 'owner')\n  async createManual(\n    @Body() dto: CreateAdminManualBookingDto,\n    @Req() request: { user: AuthUser },\n  ) {\n    return this.tableLock.withCreateLock(dto, async () => {\n      await this.availabilityBlocks.assertBookable(dto);\n      return this.service.createManual(dto, request.user);\n    });\n  }\n\n  @Public()\n  @Get('availability')",
)

# Manual create service: approved immediately, no guest token/device id, same atomic table/date lock via controller.
replace_once(
    'backend/src/bookings/bookings.service.ts',
    "import { CreateBookingDto } from './dto/create-booking.dto';",
    "import { CreateAdminManualBookingDto } from './dto/create-admin-manual-booking.dto';\nimport { CreateBookingDto } from './dto/create-booking.dto';",
)
replace_once(
    'backend/src/bookings/bookings.service.ts',
    "  private normalizeDuration(durationMinutes?: number) {",
    "  private async assertNoActivePhoneBooking(bookingDate: string, phone: string) {\n    const normalizedPhone = this.normalizePhone(phone);\n    if (!normalizedPhone) {\n      throw new BadRequestException('Вкажіть коректний номер телефону');\n    }\n\n    const activeBookings = await this.bookings\n      .createQueryBuilder('booking')\n      .leftJoinAndSelect('booking.client', 'client')\n      .addSelect('booking.guestPhoneNormalized')\n      .where('booking.bookingDate = :bookingDate', { bookingDate })\n      .andWhere('booking.status IN (:...statuses)', { statuses: ACTIVE_BOOKING_STATUSES })\n      .getMany();\n\n    const duplicate = activeBookings.some(\n      (booking) =>\n        booking.guestPhoneNormalized === normalizedPhone ||\n        this.normalizePhone(booking.client?.phone) === normalizedPhone,\n    );\n\n    if (duplicate) {\n      throw new BadRequestException('На цю дату вже є активне бронювання з цього номера телефону');\n    }\n\n    return normalizedPhone;\n  }\n\n  private normalizeDuration(durationMinutes?: number) {",
)
replace_once(
    'backend/src/bookings/bookings.service.ts',
    "  async getPublicStatus(id: string) {",
    "  async createManual(dto: CreateAdminManualBookingDto, actor?: AuthUser) {\n    try {\n      const bookingDate = this.normalizeBookingDate(dto.bookingDate);\n      const guestPhoneNormalized = await this.assertNoActivePhoneBooking(bookingDate, dto.phone);\n\n      const table = await this.tables.findOne({\n        where: { id: dto.tableId },\n        relations: ['zone'],\n      });\n      if (!table) throw new NotFoundException('Стіл не знайдено');\n      await this.assertTableCanBeBooked(table);\n\n      let client = await this.clients.findOne({ where: { phone: dto.phone } });\n      if (!client) {\n        client = await this.clients.save(\n          this.clients.create({ fullName: dto.fullName, phone: dto.phone }),\n        );\n      }\n      if (client.isBlacklisted) {\n        throw new BadRequestException('Бронювання з цього номера недоступне');\n      }\n\n      const timeInfo = await this.assertNoTimeConflict(\n        table.id,\n        bookingDate,\n        dto.bookingTime,\n        dto.durationMinutes,\n      );\n      const wishes = [\n        `Час відпочинку: ${timeInfo.durationMinutes} хв (${timeInfo.bookingTimeLabel} — ${timeInfo.departureTimeLabel})`,\n        `Підготовка столу після гостей: ${timeInfo.cleanupMinutes} хв, наступний гість з ${timeInfo.availableFromLabel}`,\n        dto.wishes || '',\n      ].filter(Boolean).join('\\n');\n\n      // Ручне бронювання Адміністратора не залежить від перемикача онлайн-бронювання.\n      const booking = await this.bookings.save(\n        this.bookings.create({\n          table,\n          client,\n          guestAccessTokenHash: null,\n          guestDeviceIdHash: null,\n          guestPhoneNormalized,\n          bookingDate,\n          bookingTime: timeInfo.bookingTime,\n          durationMinutes: timeInfo.durationMinutes,\n          guestsCount: dto.guestsCount,\n          wishes,\n          status: 'approved',\n          source: 'admin_manual',\n          approvedAt: new Date(),\n        }),\n      );\n\n      await this.saveHistory(\n        booking,\n        'booking_created',\n        actor?.role || 'admin',\n        null,\n        this.bookingSnapshot(booking),\n        null,\n        actor || null,\n      );\n      await this.setTableStatusOnlyForToday(table, 'reserved', bookingDate);\n      await this.safeLog('Створено ручне бронювання', {\n        bookingId: booking.id,\n        tableNumber: table.tableNumber,\n        clientName: client.fullName,\n        bookingDate,\n        time: `${timeInfo.bookingTimeLabel} — ${timeInfo.departureTimeLabel}`,\n        durationMinutes: timeInfo.durationMinutes,\n        source: 'admin_manual',\n        actorRole: actor?.role || null,\n        actorStaffId: actor?.staffId || null,\n        actorName: actor?.name || null,\n      });\n\n      return {\n        message: 'Бронювання створено та підтверджено',\n        bookingId: booking.id,\n        status: booking.status,\n        bookingDate,\n        bookingTime: timeInfo.bookingTime,\n        departureTime: timeInfo.departureTime,\n        availableFrom: timeInfo.availableFrom,\n        durationMinutes: timeInfo.durationMinutes,\n        cleanupMinutes: timeInfo.cleanupMinutes,\n      };\n    } catch (error: any) {\n      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;\n      if (\n        (error?.code || error?.driverError?.code) === '23505' &&\n        (error?.constraint || error?.driverError?.constraint) ===\n          'UQ_bookings_active_guest_phone_date'\n      ) {\n        throw new BadRequestException('На цю дату вже є активне бронювання з цього номера телефону');\n      }\n      console.error('Manual booking create failed:', error);\n      throw new BadRequestException(\n        `Не вдалося створити бронювання: ${error?.message || 'невідома помилка'}`,\n      );\n    }\n  }\n\n  async getPublicStatus(id: string) {",
)

# Frontend API: manual endpoint deliberately does not store guest runtime access.
replace_once(
    'frontend/src/api/bookings.ts',
    "export type BookingAvailability = {",
    "export type CreateAdminManualBookingPayload = {\n  tableId: string;\n  fullName: string;\n  phone: string;\n  bookingDate: string;\n  bookingTime: string;\n  guestsCount: number;\n  durationMinutes?: number;\n  wishes?: string;\n};\n\nexport type BookingAvailability = {",
)
replace_once(
    'frontend/src/api/bookings.ts',
    "  availability: (params: {",
    "  createManual: (payload: CreateAdminManualBookingPayload) =>\n    api.post<{\n      message: string;\n      bookingId: string;\n      status: string;\n      bookingDate: string;\n      bookingTime: string;\n      departureTime: string;\n      availableFrom: string;\n      durationMinutes: number;\n      cleanupMinutes: number;\n    }>('/bookings/admin/manual', payload),\n\n  availability: (params: {",
)

# Admin planner state and actions. Do not touch map geometry/click zones.
replace_once(
    'frontend/src/admin/AdminVisualTablePlanner.tsx',
    "  const [transferBookingId, setTransferBookingId] = useState<string | null>(null);\n  const [transferTableId, setTransferTableId] = useState('');\n  const [busy, setBusy] = useState('');",
    "  const [transferBookingId, setTransferBookingId] = useState<string | null>(null);\n  const [transferTableId, setTransferTableId] = useState('');\n  const [manualBookingOpen, setManualBookingOpen] = useState(false);\n  const [manualDate, setManualDate] = useState(today);\n  const [manualTime, setManualTime] = useState('18:00');\n  const [manualFullName, setManualFullName] = useState('');\n  const [manualPhone, setManualPhone] = useState('');\n  const [manualGuestsCount, setManualGuestsCount] = useState('2');\n  const [manualDurationMinutes, setManualDurationMinutes] = useState('120');\n  const [manualWishes, setManualWishes] = useState('');\n  const [busy, setBusy] = useState('');",
)
replace_once(
    'frontend/src/admin/AdminVisualTablePlanner.tsx',
    "  useEffect(() => { setTarget(null); void load(); }, [date, time]);\n\n  function realTable",
    "  useEffect(() => { setTarget(null); void load(); }, [date, time]);\n  useEffect(() => { setManualBookingOpen(false); }, [target?.type, target?.id]);\n\n  function realTable",
)
replace_once(
    'frontend/src/admin/AdminVisualTablePlanner.tsx',
    "  async function setPhysicalStatus(status: 'free' | 'occupied' | 'cleaning' | 'closed') {",
    "  function openManualBooking() {\n    if (!selectedTable) return;\n    setManualDate(date);\n    setManualTime(time);\n    setManualFullName('');\n    setManualPhone('');\n    setManualGuestsCount(String(Math.min(2, Math.max(1, Number(selectedTable.seats) || 2))));\n    setManualDurationMinutes('120');\n    setManualWishes('');\n    setError('');\n    setNotice('');\n    setManualBookingOpen(true);\n  }\n\n  async function createManualBooking() {\n    if (!selectedTable) return;\n    const fullName = manualFullName.trim();\n    const phone = manualPhone.trim();\n    const guestsCount = Number(manualGuestsCount);\n    const durationMinutes = Number(manualDurationMinutes);\n\n    if (!fullName || !phone || !manualDate || !manualTime) {\n      setError('Заповніть ім’я, телефон, дату та час');\n      return;\n    }\n    if (!Number.isInteger(guestsCount) || guestsCount < 1 || guestsCount > 30) {\n      setError('Кількість гостей має бути від 1 до 30');\n      return;\n    }\n    if (!Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 720) {\n      setError('Тривалість має бути від 30 до 720 хвилин');\n      return;\n    }\n\n    setBusy('manual-booking');\n    setError('');\n    setNotice('');\n    try {\n      await bookingsApi.createManual({\n        tableId: selectedTable.id,\n        fullName,\n        phone,\n        bookingDate: manualDate,\n        bookingTime: manualTime,\n        guestsCount,\n        durationMinutes,\n        wishes: manualWishes.trim() || undefined,\n      });\n      setNotice(`Бронювання створено і підтверджено: ${manualDate} о ${manualTime}`);\n      setManualBookingOpen(false);\n      await load(true);\n    } catch (actionError: any) {\n      setError(actionError?.message || 'Не вдалося створити бронювання');\n    } finally {\n      setBusy('');\n    }\n  }\n\n  async function setPhysicalStatus(status: 'free' | 'occupied' | 'cleaning' | 'closed') {",
)
replace_once(
    'frontend/src/admin/AdminVisualTablePlanner.tsx',
    "\n\n          {selectedTable && date === today && <div className=\"mt-4\">",
    "\n\n          {mode === 'admin' && selectedTable && <div className=\"mt-4 rounded-[24px] border border-sky-300/25 bg-sky-400/[.07] p-3\"><button type=\"button\" onClick={() => manualBookingOpen ? setManualBookingOpen(false) : openManualBooking()} className=\"inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-sky-200/45 bg-sky-300/10 px-4 py-3 font-black text-sky-100 transition active:scale-[.98]\"><CalendarClock size={18} />Створити бронювання</button>{manualBookingOpen && <div className=\"mt-3 space-y-3\"><p className=\"text-xs leading-5 text-white/50\">Бронювання одразу буде підтверджено. Офіціант побачить його у своєму пульті тільки в день бронювання.</p><div className=\"grid grid-cols-2 gap-2\"><label className=\"rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/40\">Дата<input type=\"date\" min={today} value={manualDate} onChange={(event) => setManualDate(event.target.value)} className=\"mt-1 block w-full bg-transparent text-base font-black text-white outline-none\" /></label><label className=\"rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/40\">Час<input type=\"time\" value={manualTime} onChange={(event) => setManualTime(event.target.value)} className=\"mt-1 block w-full bg-transparent text-base font-black text-white outline-none\" /></label></div><label className=\"block text-xs text-white/45\">Ім’я гостя<input type=\"text\" value={manualFullName} onChange={(event) => setManualFullName(event.target.value)} className=\"mt-1 w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-base text-white outline-none focus:border-sky-200/40\" /></label><label className=\"block text-xs text-white/45\">Телефон гостя<input type=\"tel\" inputMode=\"tel\" autoComplete=\"tel\" value={manualPhone} onChange={(event) => setManualPhone(event.target.value)} className=\"mt-1 w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-base text-white outline-none focus:border-sky-200/40\" /></label><div className=\"grid grid-cols-2 gap-2\"><label className=\"rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/40\">Гостей<input type=\"number\" min={1} max={30} value={manualGuestsCount} onChange={(event) => setManualGuestsCount(event.target.value)} className=\"mt-1 block w-full bg-transparent text-base font-black text-white outline-none\" /></label><label className=\"rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/40\">Тривалість, хв<input type=\"number\" min={30} max={720} step={30} value={manualDurationMinutes} onChange={(event) => setManualDurationMinutes(event.target.value)} className=\"mt-1 block w-full bg-transparent text-base font-black text-white outline-none\" /></label></div><label className=\"block text-xs text-white/45\">Побажання<textarea value={manualWishes} onChange={(event) => setManualWishes(event.target.value)} className=\"mt-1 min-h-20 w-full rounded-2xl border border-white/10 bg-black/25 p-3 text-base text-white outline-none focus:border-sky-200/40\" /></label><button type=\"button\" disabled={busy === 'manual-booking' || !manualFullName.trim() || !manualPhone.trim()} onClick={() => void createManualBooking()} className=\"w-full rounded-2xl bg-sky-300 px-4 py-4 font-black text-neutral-950 disabled:opacity-35\">{busy === 'manual-booking' ? 'Створюємо…' : 'Створити й підтвердити'}</button></div>}</div>}\n\n          {selectedTable && date === today && <div className=\"mt-4\">",
)

# Frontend regression test is wired into the existing test command.
Path('frontend/test/admin-manual-booking.test.cjs').write_text("""const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const planner = fs.readFileSync(path.join(root, 'src/admin/AdminVisualTablePlanner.tsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'src/api/bookings.ts'), 'utf8');
const waiter = fs.readFileSync(path.join(root, 'src/waiter/WaiterAppV2.tsx'), 'utf8');

assert.match(planner, /Створити бронювання/);
assert.match(planner, /bookingsApi\.createManual\(\{/);
assert.match(planner, /tableId: selectedTable\.id/);
assert.match(planner, /bookingDate: manualDate/);
assert.match(planner, /bookingTime: manualTime/);
assert.match(planner, /Офіціант побачить його у своєму пульті тільки в день бронювання/);
assert.match(api, /\/bookings\/admin\/manual/);
assert.match(waiter, /bookingsApi\.getToday\(\)/);
assert.match(waiter, /setInterval\(\(\) => void load\(\), 15000\)/);

console.log('admin manual booking frontend regression passed');
""")
replace_once(
    'frontend/package.json',
    "&& node test/iphone-admin-phone-link.test.cjs\"",
    "&& node test/iphone-admin-phone-link.test.cjs && node test/admin-manual-booking.test.cjs\"",
)

# Backend behavior/authorization regression tests.
Path('backend/test/admin-manual-booking.test.js').write_text("""require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { ROLES_KEY } = require('../dist/common/decorators/roles.decorator.js');
const { BookingsController } = require('../dist/bookings/bookings.controller.js');
const { BookingsService } = require('../dist/bookings/bookings.service.js');

test('admin manual endpoint keeps lock + availability guard and forwards actor', async () => {
  const calls = [];
  const actor = { role: 'admin', staffId: 'staff-1', name: 'Admin' };
  const dto = {
    tableId: 'table-1',
    fullName: 'Гість',
    phone: '+380000000000',
    bookingDate: '2026-09-10',
    bookingTime: '18:00',
    guestsCount: 2,
    durationMinutes: 120,
  };
  const service = {
    async createManual(payload, receivedActor) {
      calls.push(['service', payload, receivedActor]);
      return { message: 'Бронювання створено та підтверджено' };
    },
  };
  const tableLock = {
    async withCreateLock(payload, work) {
      calls.push(['lock', payload]);
      return work();
    },
  };
  const availability = {
    async assertBookable(payload) {
      calls.push(['availability', payload]);
    },
  };
  const controller = new BookingsController(
    service,
    {},
    {},
    tableLock,
    availability,
    {},
    {},
    {},
    {},
  );

  const result = await controller.createManual(dto, { user: actor });

  assert.deepEqual(result, { message: 'Бронювання створено та підтверджено' });
  assert.equal(calls[0][0], 'lock');
  assert.equal(calls[1][0], 'availability');
  assert.equal(calls[2][0], 'service');
  assert.deepEqual(calls[2][2], actor);
  assert.deepEqual(
    Reflect.getMetadata(ROLES_KEY, BookingsController.prototype.createManual),
    ['admin', 'owner'],
  );
});

test('manual booking is saved approved without guest browser credentials', async () => {
  const saved = [];
  const histories = [];
  const tableStatus = [];
  const table = {
    id: 'table-1',
    tableNumber: '5',
    seats: 6,
    isVisible: true,
    status: 'free',
    zone: { isClosed: false, isVisible: true },
  };
  const bookings = {
    create(value) {
      return { id: 'booking-1', ...value };
    },
    async save(value) {
      saved.push(value);
      return value;
    },
  };
  const clients = {
    async findOne() {
      return null;
    },
    create(value) {
      return value;
    },
    async save(value) {
      return { id: 'client-1', isBlacklisted: false, ...value };
    },
  };
  const tables = {
    async findOne() {
      return table;
    },
  };
  const service = new BookingsService(
    bookings,
    {},
    {},
    clients,
    tables,
    {},
    { create: async () => undefined },
    {},
    {},
  );

  service.assertNoActivePhoneBooking = async () => '380000000000';
  service.assertTableCanBeBooked = async () => undefined;
  service.assertNoTimeConflict = async () => ({
    bookingTime: '18:00:00',
    bookingTimeLabel: '18:00',
    departureTime: '20:00:00',
    departureTimeLabel: '20:00',
    availableFrom: '20:15:00',
    availableFromLabel: '20:15',
    durationMinutes: 120,
    cleanupMinutes: 15,
  });
  service.saveHistory = async (...args) => histories.push(args);
  service.setTableStatusOnlyForToday = async (...args) => tableStatus.push(args);
  service.safeLog = async () => undefined;

  const actor = { role: 'admin', staffId: 'staff-1', name: 'Admin' };
  const result = await service.createManual(
    {
      tableId: 'table-1',
      fullName: 'Гість',
      phone: '+380000000000',
      bookingDate: '2026-09-10',
      bookingTime: '18:00',
      guestsCount: 2,
      durationMinutes: 120,
      wishes: 'Тихий стіл',
    },
    actor,
  );

  assert.equal(saved.length, 1);
  assert.equal(saved[0].status, 'approved');
  assert.equal(saved[0].source, 'admin_manual');
  assert.equal(saved[0].guestAccessTokenHash, null);
  assert.equal(saved[0].guestDeviceIdHash, null);
  assert.equal(saved[0].guestPhoneNormalized, '380000000000');
  assert.ok(saved[0].approvedAt instanceof Date);
  assert.equal(result.status, 'approved');
  assert.equal(histories[0][1], 'booking_created');
  assert.equal(histories[0][2], 'admin');
  assert.deepEqual(histories[0][6], actor);
  assert.equal(tableStatus[0][1], 'reserved');
  assert.equal(tableStatus[0][2], '2026-09-10');
});
""")

print('admin manual booking patch applied')
