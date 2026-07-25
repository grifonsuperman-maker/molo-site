import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Req,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

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
    return this.reviews.find({
      relations: [
        'booking',
        'booking.client',
        'booking.table',
        'booking.table.zone',
      ],
      order: { createdAt: 'DESC' },
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
      where: { id },
      relations: [
        'booking',
        'booking.client',
        'booking.table',
        'booking.table.zone',
      ],
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
}
