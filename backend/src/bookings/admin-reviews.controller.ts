import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { Roles } from '../common/decorators/roles.decorator';
import { GuestReview } from './entities/guest-review.entity';

@Roles('owner', 'admin')
@Controller('bookings/admin-reviews')
export class AdminReviewsController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  findAll() {
    return this.dataSource.getRepository(GuestReview).find({
      relations: ['booking', 'booking.table', 'booking.table.zone', 'booking.client'],
      order: { createdAt: 'DESC' },
      take: 500,
    });
  }
}
