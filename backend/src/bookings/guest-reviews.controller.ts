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

import { Roles } from '../common/decorators/roles.decorator';
import { RestaurantService } from '../restaurant/restaurant.service';
import { RespondGuestReviewDto } from './dto/respond-guest-review.dto';
import { GuestReview } from './entities/guest-review.entity';

@Roles('owner', 'admin')
@Controller('guest-reviews')
export class GuestReviewsController {
  constructor(
    @InjectRepository(GuestReview)
    private readonly reviews: Repository<GuestReview>,
    private readonly restaurant: RestaurantService,
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
    @Req() request: any,
  ) {
    if (request.user?.role === 'admin') {
      await this.restaurant.assertAdminPermission(
        'adminCanRespondReviews',
        'Директор не надав право відповідати на відгуки',
      );
    }

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

    return this.reviews.save(review);
  }
}
