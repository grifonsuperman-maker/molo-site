import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { Restaurant } from '../restaurant/entities/restaurant.entity';

@Injectable()
export class AvailabilityPermissionsService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,
  ) {}

  async assertCanManage(actor?: AuthUser) {
    if (actor?.role === 'owner') return;
    if (actor?.role !== 'admin') {
      throw new ForbiddenException('Недостатньо прав для керування столами та локаціями');
    }

    const [restaurant] = await this.restaurants.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });
    if (!restaurant?.adminCanManageZones) {
      throw new ForbiddenException(
        'Директор не надав право керувати столами та локаціями',
      );
    }
  }
}
