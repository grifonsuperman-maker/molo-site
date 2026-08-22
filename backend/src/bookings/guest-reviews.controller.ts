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
import { IsNull, Not, Repository } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { Roles } from '../common/decorators/roles.decorator';
import { LogsService } from '../logs/logs.service';
import { AdminPermissionsService } from '../restaurant/admin-permissions.service';
import { RespondGuestReviewDto } from './dto/respond-guest-review.dto';
import { GuestReview } from './entities/guest-review.entity';

const REVIEW_RELATIONS = [
  'booking',
  'booking.client',
  'booking.table',
  'booking.table.zone',
];

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
    return this.reviews.find({
      where: { archivedAt: IsNull() },
      relations: REVIEW_RELATIONS,
      order: { createdAt: 'DESC' },
      take: 300,
    });
  }

  @Get('archive')
  @Roles('owner')
  findArchive() {
    return this.reviews.find({
      where: { archivedAt: Not(IsNull()) },
      relations: REVIEW_RELATIONS,
      order: { archivedAt: 'DESC', createdAt: 'DESC' },
      take: 300,
    });
  }

  @Patch(':id/response')
  async respond(
    @Param('id') id: string,
    @Body() dto: RespondGuestReviewDto,
    @Req() request: { user?: AuthUser },
  ) {
    await this.permissions.assert(request.user, 'adminCanRespondReviews');

    const review = await this.reviews.findOne({
      where: { id, archivedAt: IsNull() },
      relations: REVIEW_RELATIONS,
    });

    if (!review) throw new NotFoundException('Відгук не знайдено');

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
    if (review.archivedAt) return review;

    review.archivedAt = new Date();
    const saved = await this.reviews.save(review);
    await this.logs.create('Відгук переміщено до архіву', null, {
      reviewId: review.id,
      guestName: review.booking?.client?.fullName || null,
      performedByRole: request.user?.role,
      performedByName: request.user?.name,
    });
    return saved;
  }

  @Patch(':id/restore')
  @Roles('owner')
  async restore(
    @Param('id') id: string,
    @Req() request: { user?: AuthUser },
  ) {
    const review = await this.findReview(id);
    if (!review.archivedAt) return review;

    review.archivedAt = null;
    const saved = await this.reviews.save(review);
    await this.logs.create('Відгук відновлено з архіву', null, {
      reviewId: review.id,
      guestName: review.booking?.client?.fullName || null,
      performedByRole: request.user?.role,
      performedByName: request.user?.name,
    });
    return saved;
  }

  @Delete(':id')
  @Roles('owner')
  async deletePermanently(
    @Param('id') id: string,
    @Req() request: { user?: AuthUser },
  ) {
    const review = await this.findReview(id);
    if (!review.archivedAt) {
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

  private async findReview(id: string) {
    const review = await this.reviews.findOne({
      where: { id },
      relations: REVIEW_RELATIONS,
    });
    if (!review) throw new NotFoundException('Відгук не знайдено');
    return review;
  }
}
