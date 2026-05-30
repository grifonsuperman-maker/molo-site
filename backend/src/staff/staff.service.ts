import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Staff } from './entities/staff.entity';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

@Injectable()
export class StaffService {
  constructor(
    @InjectRepository(Staff)
    private readonly staffRepo: Repository<Staff>,
  ) {}

  findAll() {
    return this.staffRepo.find({
      order: { createdAt: 'DESC' },
    });
  }

  create(dto: CreateStaffDto) {
    const staff = this.staffRepo.create({
      fullName: dto.fullName,
      phone: dto.phone || null,
      telegramId: dto.telegramId || null,
      role: dto.role,
      active: true,
    });

    return this.staffRepo.save(staff);
  }

  async update(id: string, dto: UpdateStaffDto) {
    const staff = await this.staffRepo.findOne({ where: { id } });

    if (!staff) {
      throw new NotFoundException('Співробітника не знайдено');
    }

    Object.assign(staff, dto);

    return this.staffRepo.save(staff);
  }

  async setActive(id: string, active: boolean) {
    const staff = await this.staffRepo.findOne({ where: { id } });

    if (!staff) {
      throw new NotFoundException('Співробітника не знайдено');
    }

    staff.active = active;

    return this.staffRepo.save(staff);
  }

  async remove(id: string) {
    const staff = await this.staffRepo.findOne({ where: { id } });

    if (!staff) {
      throw new NotFoundException('Співробітника не знайдено');
    }

    await this.staffRepo.remove(staff);

    return { message: 'Співробітника видалено' };
  }
}
