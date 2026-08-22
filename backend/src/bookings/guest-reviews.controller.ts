import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Req,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

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

  @Get('archive')
  @Roles('owner')
  findArchive() {
    return this.reviewQuery()
      .innerJoin(
        'guest_review_archives',
        'review_archive',
        'review_archive.guest_review_id = review.id',
      )
      .orderBy('review_archive.archived_at', 'DESC')
      .addOrderBy('review.createdAt', 'DESC')
      .take(300)
      .getMany();
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
    const review = await this.findReview(id);
    const inserted = await this.reviews.query(
      `INSERT INTO "guest_review_archives" ("guest_review_id", "archived_at")
       VALUES ($1, NOW())
       ON CONFLICT ("guest_review_id") DO NOTHING
       RETURNING "guest_review_id"`,
      [id],
    );

    if (inserted.length) {
      await this.logs.create('Відгук переміщено до архіву', null, {
        reviewId: review.id,
        guestName: review.booking?.client?.fullName || null,
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
    const review = await this.findReview(id);
    const removed = await this.reviews.query(
      `DELETE FROM "guest_review_archives"
       WHERE "guest_review_id" = $1
       RETURNING "guest_review_id"`,
      [id],
    );

    if (removed.length) {
      await this.logs.create('Відгук відновлено з архіву', null, {
        reviewId: review.id,
        guestName: review.booking?.client?.fullName || null,
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
    const review = await this.findReview(id);
    if (!(await this.isArchived(id))) {
      throw new BadRequestException(
        'Спочатку перемістіть відгук до архіву',
      );
    }

    const guestName = review.booking?.client?.fullName || null;
    await this.reviews.remove(review);
    await this.logs.create('Відгук видалено назавжди', null, {
      reviewId: id,
      guestName,
      performedByRole: request.user?.role,
      performedByName: request.user?.name,
    });
    return { ok: true, id };
  }

  private reviewQuery(): SelectQueryBuilder<GuestReview> {
    return this.reviews
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

  private async isArchived(id: string): Promise<boolean> {
    const rows = await this.reviews.query(
      `SELECT EXISTS (
         SELECT 1
         FROM "guest_review_archives"
         WHERE "guest_review_id" = $1
       ) AS "archived"`,
      [id],
    );
    return Boolean(rows[0]?.archived);
  }
}
