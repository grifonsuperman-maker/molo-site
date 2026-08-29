from pathlib import Path
from textwrap import dedent


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if text.count(old) != 1:
        raise SystemExit(f"{label} anchor mismatch: {text.count(old)}")
    return text.replace(old, new, 1)


bookings_path = Path("backend/src/bookings/bookings.service.ts")
bookings = bookings_path.read_text()
old_lookup = dedent("""\
  private async findClientByPhone(phone: string) {
    const exact = await this.clients.findOne({ where: { phone } });
    if (exact) return exact;

    const phoneCandidates = this.phoneIdentityCandidates(phone);
    if (!phoneCandidates.length) return null;

    return this.clients.findOne({
      where: {
        phone: Raw(
          (alias) =>
            `regexp_replace(${alias}, '[^0-9]', '', 'g') IN (:...phoneCandidates)`,
          { phoneCandidates },
        ),
      },
      order: { createdAt: 'ASC' },
    });
  }
""")
new_lookup = dedent("""\
  private async findClientByPhone(phone: string) {
    const phoneCandidates = this.phoneIdentityCandidates(phone);
    if (!phoneCandidates.length) return null;

    const matches = await this.clients.find({
      where: {
        phone: Raw(
          (alias) =>
            `regexp_replace(${alias}, '[^0-9]', '', 'g') IN (:...phoneCandidates)`,
          { phoneCandidates },
        ),
      },
      order: { createdAt: 'ASC' },
    });
    if (!matches.length) return null;

    const telegramIds = new Set(
      matches
        .map((client) => String(client.telegramId || '').trim())
        .filter(Boolean),
    );

    if (telegramIds.size > 1) {
      return matches.find((client) => client.phone === phone) || matches[0];
    }

    const canonical =
      matches.find((client) => Boolean(client.telegramId)) || matches[0];
    const blacklisted = matches.find((client) => client.isBlacklisted);
    if (blacklisted) {
      canonical.isBlacklisted = true;
      canonical.blacklistReason =
        canonical.blacklistReason || blacklisted.blacklistReason || null;
      canonical.blacklistedAt =
        canonical.blacklistedAt || blacklisted.blacklistedAt || null;
    }

    return canonical;
  }
""")
bookings_path.write_text(
    replace_once(bookings, old_lookup, new_lookup, "BookingsService phone lookup")
)

expiration_path = Path("backend/src/bookings/booking-expiration.service.ts")
expiration = expiration_path.read_text()
expiration = replace_once(
    expiration,
    "import { In, LessThan, Repository } from 'typeorm';",
    "import { In, Repository } from 'typeorm';",
    "expiration typeorm import",
)
helper_anchor = "import { Booking, BookingStatus } from './entities/booking.entity';\n"
helper_import = "import { refreshClientVisitStats } from './client-visit-stats';\n"
if helper_import not in expiration:
    expiration = replace_once(
        expiration,
        helper_anchor,
        helper_anchor + helper_import,
        "expiration helper import",
    )

old_completion = dedent("""\
      const expiredBookings = await this.bookings.find({
        where: {
          bookingDate: LessThan(today),
          status: In(ACTIVE_BOOKING_STATUSES),
        },
        relations: {
          table: true,
        },
        order: {
          bookingDate: 'ASC',
          bookingTime: 'ASC',
        },
      });

      if (expiredBookings.length === 0) {
        return;
      }

      const completedAt = new Date();
      const affectedTableIds = new Set<string>();

      for (const booking of expiredBookings) {
        booking.status = 'completed';
        booking.completedAt ??= completedAt;

        if (booking.table?.id) {
          affectedTableIds.add(booking.table.id);
        }
      }

      await this.bookings.save(expiredBookings);
""")
new_completion = dedent("""\
      const completion = await this.bookings.manager.transaction(async (manager) => {
        const bookingRepo = manager.getRepository(Booking);
        const expiredBookings = await bookingRepo
          .createQueryBuilder('booking')
          .where('booking.bookingDate < :today', { today })
          .andWhere('booking.status IN (:...statuses)', {
            statuses: ACTIVE_BOOKING_STATUSES,
          })
          .orderBy('booking.bookingDate', 'ASC')
          .addOrderBy('booking.bookingTime', 'ASC')
          .setLock('pessimistic_write')
          .getMany();

        if (expiredBookings.length === 0) {
          return { completedCount: 0, tableIds: [] as string[] };
        }

        const completedAt = new Date();
        for (const booking of expiredBookings) {
          booking.status = 'completed';
          booking.completedAt ??= completedAt;
        }
        await bookingRepo.save(expiredBookings);

        const hydratedBookings = await bookingRepo.find({
          where: {
            id: In(expiredBookings.map((booking) => booking.id)),
          },
          relations: {
            table: true,
            client: true,
          },
        });

        const tableIds = Array.from(
          new Set(
            hydratedBookings
              .map((booking) => booking.table?.id)
              .filter((id): id is string => Boolean(id)),
          ),
        ).sort();
        const clientIds = Array.from(
          new Set(
            hydratedBookings
              .map((booking) => booking.client?.id)
              .filter((id): id is string => Boolean(id)),
          ),
        ).sort();

        for (const clientId of clientIds) {
          await refreshClientVisitStats(manager, clientId);
        }

        return {
          completedCount: expiredBookings.length,
          tableIds,
        };
      });

      if (completion.completedCount === 0) {
        return;
      }

      const affectedTableIds = new Set(completion.tableIds);
""")
expiration = replace_once(
    expiration,
    old_completion,
    new_completion,
    "expiration completion block",
)
expiration = replace_once(
    expiration,
    "`Automatically completed ${expiredBookings.length} expired booking(s)`,",
    "`Automatically completed ${completion.completedCount} expired booking(s)`,",
    "expiration logger count",
)
expiration_path.write_text(expiration)

clients_path = Path("backend/src/clients/clients.service.ts")
clients_path.write_text(dedent("""\
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UpdateClientDto } from './dto/update-client.dto';
import { Client } from './entities/client.entity';

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private readonly repo: Repository<Client>,
  ) {}

  private phoneIdentityKey(phone: string | null | undefined) {
    const digits = String(phone || '').replace(/\\D/g, '');
    if (/^0\\d{9}$/.test(digits)) return `ua:38${digits}`;
    if (/^380\\d{9}$/.test(digits)) return `ua:${digits}`;
    return `phone:${digits || String(phone || '').trim()}`;
  }

  private telegramIdentityCount(clients: Client[]) {
    return new Set(
      clients
        .map((client) => String(client.telegramId || '').trim())
        .filter(Boolean),
    ).size;
  }

  private canonicalClient(clients: Client[]) {
    const sorted = [...clients].sort((left, right) => {
      const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      if (leftTime !== rightTime) return leftTime - rightTime;
      return String(left.id).localeCompare(String(right.id));
    });
    return sorted.find((client) => Boolean(client.telegramId)) || sorted[0];
  }

  private projectEquivalentClients(clients: Client[], includeBookings = false) {
    const canonical = this.canonicalClient(clients);
    const lastVisitAt = clients.reduce<Date | null>((latest, client) => {
      if (!client.lastVisitAt) return latest;
      if (!latest || client.lastVisitAt.getTime() > latest.getTime()) {
        return client.lastVisitAt;
      }
      return latest;
    }, null);
    const blacklisted = [...clients]
      .filter((client) => client.isBlacklisted)
      .sort((left, right) => {
        const leftTime = left.blacklistedAt?.getTime() || 0;
        const rightTime = right.blacklistedAt?.getTime() || 0;
        return rightTime - leftTime;
      })[0];
    const notes = Array.from(
      new Set(
        clients
          .map((client) => String(client.note || '').trim())
          .filter(Boolean),
      ),
    );

    return {
      ...canonical,
      visitsCount: clients.reduce(
        (sum, client) => sum + Number(client.visitsCount || 0),
        0,
      ),
      totalGuests: clients.reduce(
        (sum, client) => sum + Number(client.totalGuests || 0),
        0,
      ),
      cancellationsCount: clients.reduce(
        (sum, client) => sum + Number(client.cancellationsCount || 0),
        0,
      ),
      reschedulesCount: clients.reduce(
        (sum, client) => sum + Number(client.reschedulesCount || 0),
        0,
      ),
      lastVisitAt,
      note: notes.length ? notes.join('\n') : null,
      isRegular: clients.some((client) => client.isRegular),
      isBlacklisted: Boolean(blacklisted),
      blacklistReason: blacklisted?.blacklistReason || null,
      blacklistedAt: blacklisted?.blacklistedAt || null,
      ...(includeBookings
        ? {
            bookings: clients.flatMap((client) => client.bookings || []),
          }
        : {}),
    };
  }

  async findAll() {
    const clients = await this.repo.find({ order: { createdAt: 'ASC' } });
    const groups = new Map<string, Client[]>();

    for (const client of clients) {
      const key = this.phoneIdentityKey(client.phone);
      const group = groups.get(key) || [];
      group.push(client);
      groups.set(key, group);
    }

    const visible = Array.from(groups.values()).flatMap((group) => {
      if (group.length === 1 || this.telegramIdentityCount(group) > 1) {
        return group;
      }
      return [this.projectEquivalentClients(group)];
    });

    return visible.sort((left, right) => {
      if (right.visitsCount !== left.visitsCount) {
        return right.visitsCount - left.visitsCount;
      }
      return (
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime()
      );
    });
  }

  async findOne(id: string) {
    const clients = await this.repo.find({
      relations: ['bookings', 'bookings.table'],
      order: { createdAt: 'ASC' },
    });
    const requested = clients.find((client) => client.id === id);
    if (!requested) throw new NotFoundException('Клієнта не знайдено');

    const key = this.phoneIdentityKey(requested.phone);
    const equivalents = clients.filter(
      (client) => this.phoneIdentityKey(client.phone) === key,
    );
    if (
      equivalents.length === 1 ||
      this.telegramIdentityCount(equivalents) > 1
    ) {
      return requested;
    }

    return this.projectEquivalentClients(equivalents, true);
  }

  async update(id: string, dto: UpdateClientDto) {
    const client = await this.repo.findOne({ where: { id } });
    if (!client) throw new NotFoundException('Клієнта не знайдено');
    Object.assign(client, dto);
    return this.repo.save(client);
  }

  async blacklist(id: string, reason: string) {
    const client = await this.repo.findOne({ where: { id } });
    if (!client) throw new NotFoundException('Клієнта не знайдено');
    client.isBlacklisted = true;
    client.blacklistReason = reason.trim();
    client.blacklistedAt = new Date();
    return this.repo.save(client);
  }

  async unblacklist(id: string) {
    const client = await this.repo.findOne({ where: { id } });
    if (!client) throw new NotFoundException('Клієнта не знайдено');
    client.isBlacklisted = false;
    client.blacklistReason = null;
    client.blacklistedAt = null;
    return this.repo.save(client);
  }
}
"""))

visit_test_path = Path("backend/test/guest-visit-stats.test.js")
visit_test = visit_test_path.read_text()
old_mock = dedent("""\
  const lookupValues = [];

  const clients = {
    async findOne({ where }) {
      lookupValues.push(where.phone);
      return typeof where.phone === 'string' ? null : existingClient;
    },
  };
""")
new_mock = dedent("""\
  const lookups = [];

  const clients = {
    async find(options) {
      lookups.push(options);
      return [existingClient];
    },
  };
""")
visit_test = replace_once(visit_test, old_mock, new_mock, "guest visit lookup mock")
visit_test = replace_once(
    visit_test,
    "  assert.equal(lookupValues.length, 2);",
    "  assert.equal(lookups.length, 1);",
    "guest visit lookup assertion",
)
visit_test_path.write_text(visit_test)

Path("backend/test/booking-expiration-visit-stats.test.js").write_text(dedent(r"""\
require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BookingExpirationService,
} = require('../dist/bookings/booking-expiration.service.js');

test('automatic completion refreshes client visit stats in the same transaction', async () => {
  const client = {
    id: 'client-1',
    visitsCount: 0,
    totalGuests: 0,
    lastVisitAt: null,
  };
  const expired = {
    id: 'booking-expired',
    bookingDate: '2020-01-01',
    bookingTime: '19:00:00',
    status: 'approved',
    guestsCount: 3,
    completedAt: null,
  };
  let expirationLock = null;
  let clientLock = null;

  const bookingRepo = {
    createQueryBuilder() {
      return {
        where() { return this; },
        andWhere() { return this; },
        orderBy() { return this; },
        addOrderBy() { return this; },
        setLock(mode) {
          expirationLock = mode;
          return this;
        },
        leftJoin() { return this; },
        async getMany() { return [expired]; },
      };
    },
    async save(values) {
      return values;
    },
    async find() {
      return [{ ...expired, client, table: null }];
    },
  };
  const clientRepo = {
    async findOne({ lock }) {
      clientLock = lock?.mode || null;
      return client;
    },
    async save(value) {
      return value;
    },
  };
  const manager = {
    getRepository(entity) {
      if (entity?.name === 'Booking') return bookingRepo;
      if (entity?.name === 'Client') return clientRepo;
      throw new Error(`Unexpected repository: ${entity?.name}`);
    },
  };
  const bookings = {
    manager: {
      transaction: async (callback) => callback(manager),
    },
    async find() {
      return [];
    },
  };
  const tables = {
    async findOne() {
      throw new Error('no table should be synchronized in this fixture');
    },
    async save() {
      throw new Error('no table should be saved in this fixture');
    },
  };

  const service = new BookingExpirationService(bookings, tables);
  await service.completeExpiredBookings();

  assert.equal(expired.status, 'completed');
  assert.ok(expired.completedAt instanceof Date);
  assert.equal(client.visitsCount, 1);
  assert.equal(client.totalGuests, 3);
  assert.equal(client.lastVisitAt, expired.completedAt);
  assert.equal(expirationLock, 'pessimistic_write');
  assert.equal(clientLock, 'pessimistic_write');
});
"""))

Path("backend/test/client-phone-reconciliation.test.js").write_text(dedent(r"""\
require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { BookingsService } = require('../dist/bookings/bookings.service.js');
const { ClientsService } = require('../dist/clients/clients.service.js');

function noopRepository() {
  return {};
}

function client(overrides) {
  return {
    id: overrides.id,
    fullName: overrides.fullName || 'Іван',
    phone: overrides.phone,
    telegramId: overrides.telegramId || null,
    visitsCount: overrides.visitsCount || 0,
    totalGuests: overrides.totalGuests || 0,
    cancellationsCount: overrides.cancellationsCount || 0,
    reschedulesCount: overrides.reschedulesCount || 0,
    lastVisitAt: overrides.lastVisitAt || null,
    note: overrides.note || null,
    isRegular: Boolean(overrides.isRegular),
    isBlacklisted: Boolean(overrides.isBlacklisted),
    blacklistReason: overrides.blacklistReason || null,
    blacklistedAt: overrides.blacklistedAt || null,
    createdAt: overrides.createdAt || new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: overrides.updatedAt || new Date('2024-01-01T00:00:00.000Z'),
    bookings: overrides.bookings || [],
  };
}

test('booking lookup chooses one canonical Ukrainian-phone client and prefers verified Telegram identity', async () => {
  const local = client({
    id: 'client-local',
    phone: '067 123 45 67',
    visitsCount: 1,
    createdAt: new Date('2023-01-01T00:00:00.000Z'),
  });
  const telegram = client({
    id: 'client-telegram',
    phone: '+380671234567',
    telegramId: '123456789',
    visitsCount: 2,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  });
  const clients = {
    async find() {
      return [local, telegram];
    },
  };
  const service = new BookingsService(
    noopRepository(),
    noopRepository(),
    noopRepository(),
    clients,
    noopRepository(),
    noopRepository(),
    {},
    {},
    {},
  );

  const resolved = await service.findClientByPhone('067 123 45 67');
  assert.equal(resolved.id, 'client-telegram');
});

test('guest database projects safe equivalent-phone rows as one card with combined visit stats', async () => {
  const olderVisit = new Date('2025-01-01T20:00:00.000Z');
  const newerVisit = new Date('2026-01-01T20:00:00.000Z');
  const local = client({
    id: 'client-local',
    phone: '067 123 45 67',
    visitsCount: 1,
    totalGuests: 2,
    lastVisitAt: olderVisit,
    createdAt: new Date('2023-01-01T00:00:00.000Z'),
  });
  const telegram = client({
    id: 'client-telegram',
    phone: '+380671234567',
    telegramId: '123456789',
    visitsCount: 2,
    totalGuests: 5,
    lastVisitAt: newerVisit,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  });
  const repo = {
    async find() {
      return [local, telegram];
    },
  };
  const service = new ClientsService(repo);

  const result = await service.findAll();
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'client-telegram');
  assert.equal(result[0].visitsCount, 3);
  assert.equal(result[0].totalGuests, 7);
  assert.equal(result[0].lastVisitAt, newerVisit);
});

test('equivalent phones with different verified Telegram identities are not merged', async () => {
  const first = client({
    id: 'client-a',
    phone: '0671234567',
    telegramId: '111',
  });
  const second = client({
    id: 'client-b',
    phone: '+380671234567',
    telegramId: '222',
  });
  const repo = {
    async find() {
      return [first, second];
    },
  };
  const service = new ClientsService(repo);

  const result = await service.findAll();
  assert.equal(result.length, 2);
});
"""))
