import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Staff } from '../staff/entities/staff.entity';
import { Log } from './entities/log.entity';

export type LogPage = {
  items: Log[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
};

@Injectable()
export class LogsService {
  constructor(@InjectRepository(Log) private readonly logsRepo: Repository<Log>) {}

  findAll() { return this.logsRepo.find({ relations: ['staff'], order: { createdAt: 'DESC' }, take: 300 }); }

  async findActive(page = 1, limit = 50): Promise<LogPage> {
    const [items, total] = await this.logsRepo
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.staff', 'staff')
      .leftJoin(
        'log_archives',
        'log_archive',
        'log_archive.log_id = log.id',
      )
      .where('log_archive.log_id IS NULL')
      .orderBy('log.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items,
      total,
      page,
      limit,
      hasMore: page * limit < total,
    };
  }

  async findArchive(page = 1, limit = 50): Promise<LogPage> {
    const [items, total] = await this.logsRepo
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.staff', 'staff')
      .innerJoin(
        'log_archives',
        'log_archive',
        'log_archive.log_id = log.id',
      )
      .addSelect('log_archive.archived_at', 'logArchiveArchivedAt')
      .orderBy('logArchiveArchivedAt', 'DESC')
      .addOrderBy('log.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items,
      total,
      page,
      limit,
      hasMore: page * limit < total,
    };
  }

  async archive(id: string) {
    return this.logsRepo.manager.transaction(async (manager) => {
      const repository = manager.getRepository(Log);
      const log = await repository
        .createQueryBuilder('log')
        .where('log.id = :id', { id })
        .setLock('pessimistic_write', undefined, ['log'])
        .getOne();

      if (!log) {
        throw new NotFoundException('Дію персоналу не знайдено');
      }

      await manager.query(
        `INSERT INTO "log_archives" ("log_id", "archived_at")
         VALUES ($1, CURRENT_TIMESTAMP)
         ON CONFLICT ("log_id") DO NOTHING`,
        [id],
      );

      return { ok: true, id };
    });
  }

  async deletePermanently(id: string) {
    return this.logsRepo.manager.transaction(async (manager) => {
      const repository = manager.getRepository(Log);
      const log = await repository
        .createQueryBuilder('log')
        .where('log.id = :id', { id })
        .setLock('pessimistic_write', undefined, ['log'])
        .getOne();

      if (!log) {
        throw new NotFoundException('Дію персоналу не знайдено');
      }

      const [archiveState] = await manager.query(
        `SELECT EXISTS (
           SELECT 1
           FROM "log_archives"
           WHERE "log_id" = $1
         ) AS "archived"`,
        [id],
      );

      if (!archiveState?.archived) {
        throw new BadRequestException(
          'Спочатку перемістіть дію персоналу до архіву',
        );
      }

      await repository.remove(log);
      return { ok: true, id };
    });
  }

  create(action: string, staff?: Staff | null, details?: Record<string, unknown>) {
    const staffIdFromDetails =
      !staff && typeof details?.staffId === 'string'
        ? details.staffId.trim()
        : '';
    const resolvedStaff =
      staff || (staffIdFromDetails ? ({ id: staffIdFromDetails } as Staff) : null);

    return this.logsRepo.save(
      this.logsRepo.create({
        action,
        staff: resolvedStaff,
        details: details || null,
      }),
    );
  }
}
