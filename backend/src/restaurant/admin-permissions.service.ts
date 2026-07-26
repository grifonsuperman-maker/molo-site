import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { Restaurant } from './entities/restaurant.entity';

export type AdminPermission =
  | 'adminCanManageBlacklist'
  | 'adminCanRespondReviews'
  | 'adminCanManageStaffShifts'
  | 'adminCanSendBroadcasts';

@Injectable()
export class AdminPermissionsService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,
  ) {}

  async assert(user: AuthUser | undefined, permission: AdminPermission) {
    if (!user) throw new ForbiddenException('Потрібна авторизація');
    if (user.role === 'owner') return;
    if (user.role !== 'admin') throw new ForbiddenException('Недостатньо прав');

    const restaurant = await this.restaurants.findOne({ order: { createdAt: 'ASC' } });
    if (!restaurant || !restaurant[permission]) {
      throw new ForbiddenException('Директор не надав це право Адміністратору');
    }
  }
}
