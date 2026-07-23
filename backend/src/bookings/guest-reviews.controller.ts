import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Roles } from '../common/decorators/roles.decorator';
import { GuestReview } from './entities/guest-review.entity';

@Roles('owner', 'admin')
@Controller('guest-reviews')
export class GuestReviewsController {
  constructor(
    @InjectRepository(GuestReview)
    private readonly reviews: Repository<GuestReview>,
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
}
