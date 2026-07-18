import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { hash } from 'bcryptjs';
import { In, Repository } from 'typeorm';

import { Staff } from './entities/staff.entity';

@Injectable()
export class StaffBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(StaffBootstrapService.name);

  constructor( @InjectRepository(Staff) private readonly staffRepo: Repository<Staff>, ) {}

  async onModuleInit() {
    const fullName = process.env.MOLO_BOOTSTRAP_ADMIN_NAME?.trim();
    const pin = process.env.MOLO_BOOTSTRAP_ADMIN_PIN?.trim();

    if (!fullName && !pin) {
      return;
    }

    if (!fullName || !pin) {
      this.logger.error(
        'Для першого адміністратора потрібно одночасно задати MOLO_BOOTSTRAP_ADMIN_NAME і MOLO_BOOTSTRAP_ADMIN_PIN',
      );
      return;
    }

    if (!/^\d{6}$/.test(pin)) {
      this.logger.error(
        'MOLO_BOOTSTRAP_ADMIN_PIN має містити рівно 6 цифр',
      );
      return;
    }

    const existingManager = await this.staffRepo.findOne({
      where: {
        role: In(['owner', 'admin']),
      },
    });

    if (existingManager) {
      this.logger.log(
        'Адміністратор або власник уже існує. Початкового адміністратора не створено.',
      );
      return;
    }

    const pinHash = await hash(pin, 10);

    const admin = this.staffRepo.create({
      fullName,
      phone: null,
      telegramId: null,
      role: 'admin',
      pinHash,
      note: 'Перший адміністратор, створений під час початкового налаштування',
      active: true,
      isArchived: false,
      isOnShift: false,
      shiftStartedAt: null,
      shiftStartedBy: null,
      shiftEndedAt: null,
      shiftEndedBy: null,
      lastAutoShiftEndDate: null,
      archivedAt: null,
      archivedBy: null,
    });

    await this.staffRepo.save(admin);

    this.logger.log(
      `Початкового адміністратора "${fullName}" створено. Після першого входу змініть PIN і видаліть початкові змінні середовища.`,
    );
  }
}
