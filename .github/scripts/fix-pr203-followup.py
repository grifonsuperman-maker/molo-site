from pathlib import Path

bookings_path = Path('backend/src/bookings/bookings.service.ts')
bookings = bookings_path.read_text()
old_phone_method = """  private async assertNoActivePhoneBooking(bookingDate: string, phone: string) {
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

    if (duplicate) {
      throw new BadRequestException('На цю дату вже є активне бронювання з цього номера телефону');
    }

    return normalizedPhone;
  }

"""
new_phone_method = """  private async assertNoActivePhoneBooking(
    bookingDate: string,
    phone: string,
    excludeBookingId?: string,
  ) {
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
        booking.id !== excludeBookingId &&
        this.normalizePhoneIdentity(
          booking.guestPhoneNormalized || booking.client?.phone,
        ) === normalizedPhone,
    );

    if (duplicate) {
      throw new BadRequestException('На цю дату вже є активне бронювання з цього номера телефону');
    }

    return normalizedPhone;
  }

  private async prepareGuestPhoneForActivation(booking: Booking) {
    const phone = booking.guestPhoneNormalized || booking.client?.phone;
    if (!phone) return;

    booking.guestPhoneNormalized = await this.assertNoActivePhoneBooking(
      booking.bookingDate,
      phone,
      booking.id,
    );
  }

  private async saveActivatedBooking(booking: Booking) {
    try {
      return await this.bookings.save(booking);
    } catch (error: any) {
      const code = error?.code || error?.driverError?.code;
      const constraint = error?.constraint || error?.driverError?.constraint;
      if (
        code === '23505' &&
        [
          'UQ_bookings_active_guest_device_date',
          'UQ_bookings_active_guest_phone_date',
        ].includes(constraint)
      ) {
        throw new BadRequestException(
          'На цю дату вже є активне бронювання з цього пристрою або номера телефону',
        );
      }
      throw error;
    }
  }

"""
if bookings.count(old_phone_method) != 1:
    raise SystemExit(f'phone method anchor count: {bookings.count(old_phone_method)}')
bookings = bookings.replace(old_phone_method, new_phone_method, 1)

old_approve = """    const previousData = this.bookingSnapshot(booking);
    booking.status = 'approved';
    booking.approvedAt = new Date();
    await this.bookings.save(booking);
    await this.saveHistory(booking, 'booking_approved', 'admin', previousData, this.bookingSnapshot(booking));
"""
new_approve = """    const previousData = this.bookingSnapshot(booking);
    await this.prepareGuestPhoneForActivation(booking);
    booking.status = 'approved';
    booking.approvedAt = new Date();
    await this.saveActivatedBooking(booking);
    await this.saveHistory(booking, 'booking_approved', 'admin', previousData, this.bookingSnapshot(booking));
"""
if bookings.count(old_approve) != 1:
    raise SystemExit(f'approve anchor count: {bookings.count(old_approve)}')
bookings = bookings.replace(old_approve, new_approve, 1)

old_checkin = """    const previousData = this.bookingSnapshot(booking);
    booking.status = 'approved';
    if (!booking.approvedAt) booking.approvedAt = new Date();
    if (!booking.checkedInAt) booking.checkedInAt = new Date();
    await this.bookings.save(booking);
    await this.saveHistory(
"""
new_checkin = """    const previousData = this.bookingSnapshot(booking);
    await this.prepareGuestPhoneForActivation(booking);
    booking.status = 'approved';
    if (!booking.approvedAt) booking.approvedAt = new Date();
    if (!booking.checkedInAt) booking.checkedInAt = new Date();
    await this.saveActivatedBooking(booking);
    await this.saveHistory(
"""
if bookings.count(old_checkin) != 1:
    raise SystemExit(f'check-in anchor count: {bookings.count(old_checkin)}')
bookings_path.write_text(bookings.replace(old_checkin, new_checkin, 1))

clients_path = Path('backend/src/clients/clients.service.ts')
clients = clients_path.read_text()
old_group = """  private async writableIdentityGroup(id: string) {
    const requested = await this.repo.findOne({ where: { id } });
    if (!requested) throw new NotFoundException('Клієнта не знайдено');

    const clients = await this.repo.find({ order: { createdAt: 'ASC' } });
"""
new_group = """  private async writableIdentityGroup(
    id: string,
    repo: Repository<Client> = this.repo,
  ) {
    const requested = await repo.findOne({ where: { id } });
    if (!requested) throw new NotFoundException('Клієнта не знайдено');

    const clients = await repo.find({ order: { createdAt: 'ASC' } });
"""
if clients.count(old_group) != 1:
    raise SystemExit(f'writable group anchor count: {clients.count(old_group)}')
clients = clients.replace(old_group, new_group, 1)

old_actions = """  async blacklist(id: string, reason: string) {
    const clients = await this.writableIdentityGroup(id);
    const blacklistedAt = new Date();

    for (const client of clients) {
      client.isBlacklisted = true;
      client.blacklistReason = reason.trim();
      client.blacklistedAt = blacklistedAt;
      await this.repo.save(client);
    }

    return clients.find((client) => client.id === id) || clients[0];
  }

  async unblacklist(id: string) {
    const clients = await this.writableIdentityGroup(id);

    for (const client of clients) {
      client.isBlacklisted = false;
      client.blacklistReason = null;
      client.blacklistedAt = null;
      await this.repo.save(client);
    }

    return clients.find((client) => client.id === id) || clients[0];
  }
"""
new_actions = """  private async lockedWritableIdentityGroup(
    id: string,
    repo: Repository<Client>,
  ) {
    const clients = await this.writableIdentityGroup(id, repo);
    const ids = clients.map((client) => client.id).sort();

    return repo
      .createQueryBuilder('client')
      .where('client.id IN (:...ids)', { ids })
      .orderBy('client.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
  }

  async blacklist(id: string, reason: string) {
    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(Client);
      const clients = await this.lockedWritableIdentityGroup(id, repo);
      const blacklistedAt = new Date();

      for (const client of clients) {
        client.isBlacklisted = true;
        client.blacklistReason = reason.trim();
        client.blacklistedAt = blacklistedAt;
      }
      await repo.save(clients);

      return clients.find((client) => client.id === id) || clients[0];
    });
  }

  async unblacklist(id: string) {
    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(Client);
      const clients = await this.lockedWritableIdentityGroup(id, repo);

      for (const client of clients) {
        client.isBlacklisted = false;
        client.blacklistReason = null;
        client.blacklistedAt = null;
      }
      await repo.save(clients);

      return clients.find((client) => client.id === id) || clients[0];
    });
  }
"""
if clients.count(old_actions) != 1:
    raise SystemExit(f'blacklist actions anchor count: {clients.count(old_actions)}')
clients_path.write_text(clients.replace(old_actions, new_actions, 1))

test_path = Path('backend/test/client-phone-reconciliation.test.js')
test = test_path.read_text()
old_saved = """  const rows = [local, telegram];
  const savedIds = [];
  const repo = {
    async findOne({ where }) {
      return rows.find((item) => item.id === where.id) || null;
    },
    async find() {
      return rows;
    },
    async save(value) {
      savedIds.push(value.id);
      return value;
    },
  };
"""
new_saved = """  const rows = [local, telegram];
  const savedIds = [];
  const lockCalls = [];
  const txRepo = {
    async findOne({ where }) {
      return rows.find((item) => item.id === where.id) || null;
    },
    async find() {
      return rows;
    },
    createQueryBuilder() {
      let ids = [];
      return {
        where(_sql, params) { ids = params.ids; return this; },
        orderBy() { return this; },
        setLock(mode) { lockCalls.push(mode); return this; },
        async getMany() { return rows.filter((item) => ids.includes(item.id)); },
      };
    },
    async save(value) {
      const values = Array.isArray(value) ? value : [value];
      savedIds.push(...values.map((item) => item.id));
      return value;
    },
  };
  const repo = {
    ...txRepo,
    manager: {
      async transaction(callback) {
        return callback({ getRepository: () => txRepo });
      },
    },
  };
"""
if test.count(old_saved) != 1:
    raise SystemExit(f'safe blacklist repo anchor count: {test.count(old_saved)}')
test = test.replace(old_saved, new_saved, 1)
old_safe_end = """  assert.equal(telegram.blacklistedAt, null);
  assert.deepEqual(savedIds, ['client-local', 'client-telegram']);
});
"""
new_safe_end = """  assert.equal(telegram.blacklistedAt, null);
  assert.deepEqual(savedIds, ['client-local', 'client-telegram']);
  assert.deepEqual(lockCalls, ['pessimistic_write', 'pessimistic_write']);
});
"""
if test.count(old_safe_end) != 1:
    raise SystemExit(f'safe blacklist assertion anchor count: {test.count(old_safe_end)}')
test = test.replace(old_safe_end, new_safe_end, 1)

old_conflict_repo = """  const rows = [first, second];
  const savedIds = [];
  const repo = {
    async findOne({ where }) {
      return rows.find((item) => item.id === where.id) || null;
    },
    async find() {
      return rows;
    },
    async save(value) {
      savedIds.push(value.id);
      return value;
    },
  };
"""
new_conflict_repo = """  const rows = [first, second];
  const savedIds = [];
  const lockCalls = [];
  const txRepo = {
    async findOne({ where }) {
      return rows.find((item) => item.id === where.id) || null;
    },
    async find() {
      return rows;
    },
    createQueryBuilder() {
      let ids = [];
      return {
        where(_sql, params) { ids = params.ids; return this; },
        orderBy() { return this; },
        setLock(mode) { lockCalls.push(mode); return this; },
        async getMany() { return rows.filter((item) => ids.includes(item.id)); },
      };
    },
    async save(value) {
      const values = Array.isArray(value) ? value : [value];
      savedIds.push(...values.map((item) => item.id));
      return value;
    },
  };
  const repo = {
    ...txRepo,
    manager: {
      async transaction(callback) {
        return callback({ getRepository: () => txRepo });
      },
    },
  };
"""
if test.count(old_conflict_repo) != 1:
    raise SystemExit(f'conflict blacklist repo anchor count: {test.count(old_conflict_repo)}')
test = test.replace(old_conflict_repo, new_conflict_repo, 1)
old_conflict_end = """  assert.equal(second.blacklistReason, 'B');
  assert.deepEqual(savedIds, ['client-a']);
});
"""
new_conflict_end = """  assert.equal(second.blacklistReason, 'B');
  assert.deepEqual(savedIds, ['client-a']);
  assert.deepEqual(lockCalls, ['pessimistic_write']);
});
"""
if test.count(old_conflict_end) != 1:
    raise SystemExit(f'conflict blacklist assertion anchor count: {test.count(old_conflict_end)}')
test = test.replace(old_conflict_end, new_conflict_end, 1)

test += """

test('approve canonicalizes a legacy Ukrainian phone key and excludes the current active booking', async () => {
  const booking = {
    id: 'booking-legacy',
    status: 'pending',
    bookingDate: '2099-01-01',
    bookingTime: '19:00:00',
    durationMinutes: 120,
    guestsCount: 2,
    wishes: '',
    guestPhoneNormalized: '0671234567',
    client: { id: 'client-1', phone: '067 123 45 67' },
    table: { id: 'table-1', tableNumber: '1', status: 'free' },
  };
  let saved = null;
  const query = {
    leftJoinAndSelect() { return this; },
    addSelect() { return this; },
    where() { return this; },
    andWhere() { return this; },
    async getMany() { return [booking]; },
  };
  const bookings = {
    async findOne() { return booking; },
    createQueryBuilder() { return query; },
    async save(value) { saved = value; return value; },
  };
  const histories = {
    create(value) { return value; },
    async save(value) { return value; },
  };
  const service = new BookingsService(
    bookings,
    histories,
    noopRepository(),
    noopRepository(),
    { async save() { throw new Error('future booking must not update table status'); } },
    noopRepository(),
    { async create() {} },
    { async notifyBookingApproved() {} },
    {},
  );

  await service.approve('booking-legacy');

  assert.equal(saved.guestPhoneNormalized, '380671234567');
  assert.equal(saved.status, 'approved');
});

test('reactivation rejects an equivalent legacy active phone before writing', async () => {
  const booking = {
    id: 'booking-reactivate',
    status: 'cancelled',
    bookingDate: '2099-01-01',
    bookingTime: '19:00:00',
    durationMinutes: 120,
    guestsCount: 2,
    wishes: '',
    guestPhoneNormalized: '0671234567',
    client: { id: 'client-1', phone: '0671234567' },
    table: { id: 'table-1', tableNumber: '1', status: 'free' },
  };
  const otherActive = {
    id: 'booking-other',
    guestPhoneNormalized: '380671234567',
    client: { phone: '+380671234567' },
  };
  let saveCalls = 0;
  const query = {
    leftJoinAndSelect() { return this; },
    addSelect() { return this; },
    where() { return this; },
    andWhere() { return this; },
    async getMany() { return [otherActive]; },
  };
  const bookings = {
    async findOne() { return booking; },
    createQueryBuilder() { return query; },
    async save(value) { saveCalls += 1; return value; },
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

  await assert.rejects(
    () => service.checkIn('booking-reactivate'),
    /вже є активне бронювання/,
  );
  assert.equal(saveCalls, 0);
});
"""
test_path.write_text(test)
