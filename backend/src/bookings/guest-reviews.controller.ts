import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, SelectQueryBuilder } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { Roles } from '../common/decorators/roles.decorator';
import { LogsService } from '../logs/logs.service';
import { AdminPermissionsService } from '../restaurant/admin-permissions.service';
import { RespondGuestReviewDto } from './dto/respond-guest-review.dto';
import { GuestReview } from './entities/guest-review.entity';

@Roles('owner', 'admin')
@Controller('guest-reviews')
export class GuestReviewsController {
  constructor(
    @InjectRepository(GuestReview)
    private readonly reviews: Repository<GuestReview>,
    private readonly permissions: AdminPermissionsService,
    private readonly logs: LogsService,
  ) {}

  @Get()
  findAll() {
    return this.reviewQuery()
      .leftJoin(
        'guest_review_archives',
        'review_archive',
        'review_archive.guest_review_id = review.id',
      )
      .where('review_archive.guest_review_id IS NULL')
      .orderBy('review.createdAt', 'DESC')
      .take(300)
      .getMany();
  }

  @Get('active')
  @Roles('owner')
  async findActive(
    @Query('page') pageValue?: string,
    @Query('limit') limitValue?: string,
    @Query('q') queryValue?: string,
  ) {
    const page = this.positiveInteger(pageValue, 1);
    const limit = Math.min(this.positiveInteger(limitValue, 50), 100);
    const search = String(queryValue || '').trim().toLowerCase();
    const query = this.reviewQuery()
      .leftJoin(
        'guest_review_archives',
        'review_archive',
        'review_archive.guest_review_id = review.id',
      )
      .where('review_archive.guest_review_id IS NULL');

    if (search) {
      query.andWhere(
        `(
          LOWER(COALESCE("client"."full_name", '')) LIKE :activeSearch
          OR LOWER(COALESCE("review"."text", '')) LIKE :activeSearch
          OR CAST("booking"."booking_date" AS TEXT) LIKE :activeSearch
          OR TO_CHAR("booking"."booking_date", 'DD.MM.YYYY') LIKE :activeSearch
          OR LOWER(COALESCE("table"."table_number", '')) LIKE :activeSearch
        )`,
        { activeSearch: `%${search}%` },
      );
    }

    const [items, total] = await query
      .orderBy('review.createdAt', 'DESC')
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

  @Get('archive')
  @Roles('owner')
  async findArchive(
    @Query('page') pageValue?: string,
    @Query('limit') limitValue?: string,
    @Query('q') queryValue?: string,
  ) {
    const page = this.positiveInteger(pageValue, 1);
    const limit = Math.min(this.positiveInteger(limitValue, 50), 100);
    const search = String(queryValue || '').trim().toLowerCase();
    const query = this.reviewQuery()
      .innerJoin(
        'guest_review_archives',
        'review_archive',
        'review_archive.guest_review_id = review.id',
      )
      .addSelect(
        'review_archive.archived_at',
        'reviewArchiveArchivedAt',
      );

    if (search) {
      query.andWhere(
        `(
          LOWER(COALESCE("client"."full_name", '')) LIKE :archiveSearch
          OR LOWER(COALESCE("review"."text", '')) LIKE :archiveSearch
          OR CAST("booking"."booking_date" AS TEXT) LIKE :archiveSearch
          OR TO_CHAR("booking"."booking_date", 'DD.MM.YYYY') LIKE :archiveSearch
          OR LOWER(COALESCE("table"."table_number", '')) LIKE :archiveSearch
        )`,
        { archiveSearch: `%${search}%` },
      );
    }

    const [items, total] = await query
      .orderBy('review_archive.archived_at', 'DESC')
      .addOrderBy('review.createdAt', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getManyAndCount();

    return {
      items,
      total,
      page,
      limit,
      hasMore: page * limit < total,
    };
  }

  @Patch(':id/response')
  async respond(
    @Param('id') id: string,
    @Body() dto: RespondGuestReviewDto,
    @Req() request: { user?: AuthUser },
  ) {
    await this.permissions.assert(request.user, 'adminCanRespondReviews');

    const review = await this.findReview(id);
    if (await this.isArchived(id)) {
      throw new NotFoundException('Відгук не знайдено');
    }

    review.responseText = dto.text.trim();
    review.respondedAt = new Date();
    review.respondedByName = request.user?.name || null;
    review.respondedByRole = request.user?.role || null;

    const saved = await this.reviews.save(review);
    await this.logs.create('Збережено відповідь на письмовий відгук', null, {
      reviewId: review.id,
      guestName: review.booking?.client?.fullName || null,
      performedByRole: request.user?.role,
      performedByName: request.user?.name,
    });
    return saved;
  }

  @Patch(':id/archive')
  @Roles('owner')
  async archive(
    @Param('id') id: string,
    @Req() request: { user?: AuthUser },
  ) {
    const result = await this.reviews.manager.transaction(async (manager) => {
      const review = await this.findReviewForUpdate(manager, id);
      const inserted = await manager.query(
        `INSERT INTO "guest_review_archives" ("guest_review_id", "archived_at")
         VALUES ($1, NOW())
         ON CONFLICT ("guest_review_id") DO NOTHING
         RETURNING "guest_review_id"`,
        [id],
      );
      return {
        changed: inserted.length > 0,
        guestName: review.booking?.client?.fullName || null,
      };
    });

    if (result.changed) {
      await this.logs.create('Відгук переміщено до архіву', null, {
        reviewId: id,
        guestName: result.guestName,
        performedByRole: request.user?.role,
        performedByName: request.user?.name,
      });
    }
    return { ok: true, id };
  }

  @Patch(':id/restore')
  @Roles('owner')
  async restore(
    @Param('id') id: string,
    @Req() request: { user?: AuthUser },
  ) {
    const result = await this.reviews.manager.transaction(async (manager) => {
      const review = await this.findReviewForUpdate(manager, id);
      const removed = await manager.query(
        `DELETE FROM "guest_review_archives"
         WHERE "guest_review_id" = $1
         RETURNING "guest_review_id"`,
        [id],
      );
      return {
        changed: removed.length > 0,
        guestName: review.booking?.client?.fullName || null,
      };
    });

    if (result.changed) {
      await this.logs.create('Відгук відновлено з архіву', null, {
        reviewId: id,
        guestName: result.guestName,
        performedByRole: request.user?.role,
        performedByName: request.user?.name,
      });
    }
    return { ok: true, id };
  }

  @Delete(':id')
  @Roles('owner')
  async deletePermanently(
    @Param('id') id: string,
    @Req() request: { user?: AuthUser },
  ) {
    const result = await this.reviews.manager.transaction(async (manager) => {
      const review = await this.findReviewForUpdate(manager, id);
      if (!(await this.isArchived(id, manager))) {
        throw new BadRequestException(
          'Спочатку перемістіть відгук до архіву',
        );
      }

      const guestName = review.booking?.client?.fullName || null;
      await manager.getRepository(GuestReview).remove(review);
      return { guestName };
    });

    await this.logs.create('Відгук видалено назавжди', null, {
      reviewId: id,
      guestName: result.guestName,
      performedByRole: request.user?.role,
      performedByName: request.user?.name,
    });
    return { ok: true, id };
  }

  private reviewQuery(
    repository: Repository<GuestReview> = this.reviews,
  ): SelectQueryBuilder<GuestReview> {
    return repository
      .createQueryBuilder('review')
      .leftJoinAndSelect('review.booking', 'booking')
      .leftJoinAndSelect('booking.client', 'client')
      .leftJoinAndSelect('booking.table', 'table')
      .leftJoinAndSelect('table.zone', 'zone');
  }

  private async findReview(id: string) {
    const review = await this.reviewQuery()
      .where('review.id = :id', { id })
      .getOne();
    if (!review) throw new NotFoundException('Відгук не знайдено');
    return review;
  }

  private async findReviewForUpdate(manager: EntityManager, id: string) {
    const review = await this.reviewQuery(manager.getRepository(GuestReview))
      .where('review.id = :id', { id })
      .setLock('pessimistic_write', undefined, ['review'])
      .getOne();
    if (!review) throw new NotFoundException('Відгук не знайдено');
    return review;
  }

  private async isArchived(
    id: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    const rows = manager
      ? await manager.query(
          `SELECT EXISTS (
             SELECT 1
             FROM "guest_review_archives"
             WHERE "guest_review_id" = $1
           ) AS "archived"`,
          [id],
        )
      : await this.reviews.query(
          `SELECT EXISTS (
             SELECT 1
             FROM "guest_review_archives"
             WHERE "guest_review_id" = $1
           ) AS "archived"`,
          [id],
        );
    return Boolean(rows[0]?.archived);
  }

  private positiveInteger(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
