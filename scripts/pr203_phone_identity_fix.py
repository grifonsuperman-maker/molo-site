from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label} anchor mismatch: {count}')
    return text.replace(old, new, 1)


path = Path('backend/src/bookings/bookings.service.ts')
text = path.read_text()

old_normalize = """  private normalizePhone(phone: string | null | undefined) {
    return String(phone || '').replace(/\\D/g, '');
  }

  private phoneIdentityCandidates(phone: string | null | undefined) {
"""
new_normalize = """  private normalizePhone(phone: string | null | undefined) {
    return String(phone || '').replace(/\\D/g, '');
  }

  private normalizePhoneIdentity(phone: string | null | undefined) {
    const digits = this.normalizePhone(phone);
    if (/^0\\d{9}$/.test(digits)) return `38${digits}`;
    return digits;
  }

  private phoneIdentityCandidates(phone: string | null | undefined) {
"""
text = replace_once(text, old_normalize, new_normalize, 'normalize phone')

old_guest_check = """      .leftJoinAndSelect('booking.client', 'client')
      .addSelect('booking.guestDeviceIdHash')
      .where('booking.bookingDate = :bookingDate', { bookingDate })
      .andWhere('booking.status IN (:...statuses)', { statuses: ACTIVE_BOOKING_STATUSES })
      .getMany();
    const normalizedPhone = this.normalizePhone(phone);
    const duplicate = activeBookings.some((booking) =>
      booking.guestDeviceIdHash === guestDeviceIdHash ||
      this.normalizePhone(booking.client?.phone) === normalizedPhone,
    );
"""
new_guest_check = """      .leftJoinAndSelect('booking.client', 'client')
      .addSelect('booking.guestDeviceIdHash')
      .addSelect('booking.guestPhoneNormalized')
      .where('booking.bookingDate = :bookingDate', { bookingDate })
      .andWhere('booking.status IN (:...statuses)', { statuses: ACTIVE_BOOKING_STATUSES })
      .getMany();
    const normalizedPhone = this.normalizePhoneIdentity(phone);
    const duplicate = activeBookings.some((booking) =>
      booking.guestDeviceIdHash === guestDeviceIdHash ||
      this.normalizePhoneIdentity(
        booking.guestPhoneNormalized || booking.client?.phone,
      ) === normalizedPhone,
    );
"""
text = replace_once(text, old_guest_check, new_guest_check, 'guest duplicate check')

old_manual_check = """  private async assertNoActivePhoneBooking(bookingDate: string, phone: string) {
    const normalizedPhone = this.normalizePhone(phone);
    if (!normalizedPhone) {
      throw new BadRequestException('Вкажіть коректний номер телефону');
    }

    const activeBookings = await this.bookings
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.client', 'client')
      .addSelect('booking.guestPhoneNormalized')
      .where('booking.bookingDate = :bookingDate', { bookingDate })
      .andWhere('booking.status IN (:...statuses)', { statuses: ACTIVE_BOOKING_STATUSES })
      .getMany();

    const duplicate = activeBookings.some(
      (booking) =>
        booking.guestPhoneNormalized === normalizedPhone ||
        this.normalizePhone(booking.client?.phone) === normalizedPhone,
    );
"""
new_manual_check = """  private async assertNoActivePhoneBooking(bookingDate: string, phone: string) {
    const normalizedPhone = this.normalizePhoneIdentity(phone);
    if (!normalizedPhone) {
      throw new BadRequestException('Вкажіть коректний номер телефону');
    }

    const activeBookings = await this.bookings
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.client', 'client')
      .addSelect('booking.guestPhoneNormalized')
      .where('booking.bookingDate = :bookingDate', { bookingDate })
      .andWhere('booking.status IN (:...statuses)', { statuses: ACTIVE_BOOKING_STATUSES })
      .getMany();

    const duplicate = activeBookings.some(
      (booking) =>
        this.normalizePhoneIdentity(
          booking.guestPhoneNormalized || booking.client?.phone,
        ) === normalizedPhone,
    );
"""
text = replace_once(text, old_manual_check, new_manual_check, 'manual duplicate check')

text = replace_once(
    text,
    "      const guestPhoneNormalized = this.normalizePhone(dto.phone) || null;",
    "      const guestPhoneNormalized = this.normalizePhoneIdentity(dto.phone) || null;",
    'guest stored phone identity',
)
path.write_text(text)


test_path = Path('backend/test/client-phone-reconciliation.test.js')
test_text = test_path.read_text()
addition = r"""

test('active duplicate protection treats Ukrainian local and international phone forms as one identity', async () => {
  const activeBooking = {
    guestDeviceIdHash: 'different-device',
    guestPhoneNormalized: '0671234567',
    client: { phone: '067 123 45 67' },
  };
  const query = {
    leftJoinAndSelect() { return this; },
    addSelect() { return this; },
    where() { return this; },
    andWhere() { return this; },
    async getMany() { return [activeBooking]; },
  };
  const bookings = {
    createQueryBuilder() { return query; },
  };
  const service = new BookingsService(
    bookings,
    noopRepository(),
    noopRepository(),
    noopRepository(),
    noopRepository(),
    noopRepository(),
    {},
    {},
    {},
  );

  assert.equal(service.normalizePhoneIdentity('067 123 45 67'), '380671234567');
  assert.equal(service.normalizePhoneIdentity('+380 (67) 123-45-67'), '380671234567');
  await assert.rejects(
    () => service.assertNoActiveGuestBooking(
      '2099-01-01',
      '+380 (67) 123-45-67',
      'new-device',
    ),
    /вже є активне бронювання/,
  );
});

test('manual booking phone key is canonical for atomic Ukrainian duplicate constraint', async () => {
  const query = {
    leftJoinAndSelect() { return this; },
    addSelect() { return this; },
    where() { return this; },
    andWhere() { return this; },
    async getMany() { return []; },
  };
  const bookings = {
    createQueryBuilder() { return query; },
  };
  const service = new BookingsService(
    bookings,
    noopRepository(),
    noopRepository(),
    noopRepository(),
    noopRepository(),
    noopRepository(),
    {},
    {},
    {},
  );

  assert.equal(
    await service.assertNoActivePhoneBooking('2099-01-01', '067 123 45 67'),
    '380671234567',
  );
  assert.equal(
    await service.assertNoActivePhoneBooking('2099-01-01', '+380671234567'),
    '380671234567',
  );
});
"""
if 'active duplicate protection treats Ukrainian local and international phone forms as one identity' in test_text:
    raise SystemExit('phone identity tests already exist')
test_path.write_text(test_text.rstrip() + addition + '\n')
