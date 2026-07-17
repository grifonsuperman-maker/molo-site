import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcryptjs';
import { Repository } from 'typeorm';
import { CreateStaffDto } from './dto/create-staff.dto';
import { StaffPinLoginDto } from './dto/staff-pin-login.dto';
import { StaffShiftActionDto } from './dto/staff-shift-action.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { Staff } from './entities/staff.entity';
import {
  StaffShiftEvent,
  StaffShiftEventType,
} from './entities/staff-shift-event.entity';
import type { AuthUser } from '../auth/types/auth-user.type';

@Injectable()
export class StaffService {
  constructor(
    @InjectRepository(Staff)
    private readonly staffRepo: Repository<Staff>,

    @InjectRepository(StaffShiftEvent)
    private readonly shiftEventRepo: Repository<StaffShiftEvent>,

    private readonly jwtService: JwtService,
  ) {}

  async findAll() {
    const staff = await this.staffRepo.find({
      order: {
        isArchived: 'ASC',
        role: 'ASC',
        fullName: 'ASC',
      },
    });

    return staff.map((employee) => this.toPublicStaff(employee));
  }

  async findActiveForLogin() {
    const staff = await this.staffRepo.find({
      where: {
        active: true,
        isArchived: false,
      },
      order: {
        role: 'ASC',
        fullName: 'ASC',
      },
    });

    return staff.map((employee) => ({
      id: employee.id,
      fullName: employee.fullName,
      role: employee.role,
      isOnShift: employee.isOnShift,
    }));
  }

  async findOne(id: string) {
    const staff = await this.getStaffOrThrow(id);
    return this.toPublicStaff(staff);
  }

  async create(dto: CreateStaffDto) {
    const pinHash = dto.pin ? await hash(dto.pin, 10) : null;

    const staff = this.staffRepo.create({
      fullName: dto.fullName.trim(),
      phone: dto.phone?.trim() || null,
      telegramId: dto.telegramId?.trim() || null,
      role: dto.role,
      pinHash,
      note: dto.note?.trim() || null,
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

    const saved = await this.staffRepo.save(staff);
    return this.toPublicStaff(saved);
  }

  async update(id: string, dto: UpdateStaffDto) {
    const staff = await this.getStaffOrThrow(id);
    const { pin, ...fields } = dto;

    if (fields.fullName !== undefined) {
      staff.fullName = fields.fullName.trim();
    }

    if (fields.phone !== undefined) {
      staff.phone = fields.phone?.trim() || null;
    }

    if (fields.telegramId !== undefined) {
      staff.telegramId = fields.telegramId?.trim() || null;
    }

    if (fields.role !== undefined) {
      staff.role = fields.role;
    }

    if (fields.note !== undefined) {
      staff.note = fields.note?.trim() || null;
    }

    if (pin !== undefined) {
      staff.pinHash = await hash(pin, 10);
    }

    const saved = await this.staffRepo.save(staff);
    return this.toPublicStaff(saved);
  }

  async changePin(id: string, pin: string) {
    const staff = await this.getStaffOrThrow(id);
    staff.pinHash = await hash(pin, 10);
    const saved = await this.staffRepo.save(staff);
    return this.toPublicStaff(saved);
  }

  async loginWithPin(dto: StaffPinLoginDto) {
    const staff = await this.staffRepo.findOne({
      where: {
        id: dto.staffId,
        active: true,
        isArchived: false,
      },
    });

    if (!staff || !staff.pinHash) {
      throw new UnauthorizedException('Невірний працівник або PIN');
    }

    const pinIsValid = await compare(dto.pin, staff.pinHash);

    if (!pinIsValid) {
      throw new UnauthorizedException('Невірний працівник або PIN');
    }

    if (
      (staff.role === 'waiter' || staff.role === 'hookah') &&
      !staff.isOnShift
    ) {
      throw new UnauthorizedException('Працівника не додано на зміну');
    }

    const payload: AuthUser = {
      sub: staff.id,
      telegramId: staff.telegramId || `staff:${staff.id}`,
      staffId: staff.id,
      role: staff.role,
      name: staff.fullName,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: payload,
      staff: this.toPublicStaff(staff),
    };
  }

  async startShift(id: string, dto: StaffShiftActionDto) {
    const staff = await this.getStaffOrThrow(id);

    if (staff.isArchived || !staff.active) {
      throw new BadRequestException(
        'Неактивного або архівного працівника не можна додати на зміну',
      );
    }

    if (staff.role !== 'waiter' && staff.role !== 'hookah') {
      throw new BadRequestException(
        'На зміну можна додавати лише офіціантів і кальянників',
      );
    }

    if (staff.isOnShift) {
      throw new BadRequestException('Працівник уже на зміні');
    }

    const now = new Date();
    staff.isOnShift = true;
    staff.shiftStartedAt = now;
    staff.shiftStartedBy = dto.performedBy?.trim() || null;
    staff.shiftEndedAt = null;
    staff.shiftEndedBy = null;

    const saved = await this.staffRepo.save(staff);

    await this.saveShiftEvent(
      saved,
      'shift_started',
      dto.performedBy,
      dto.comment,
    );

    return this.toPublicStaff(saved);
  }

  async endShift(id: string, dto: StaffShiftActionDto) {
    const staff = await this.getStaffOrThrow(id);

    if (!staff.isOnShift) {
      throw new BadRequestException('Працівник зараз не на зміні');
    }

    const saved = await this.finishShift(
      staff,
      'shift_ended',
      dto.performedBy,
      dto.comment,
    );

    return this.toPublicStaff(saved);
  }

  async getShiftHistory(id: string) {
    await this.getStaffOrThrow(id);

    return this.shiftEventRepo.find({
      where: {
        staff: {
          id,
        },
      },
      relations: {
        staff: true,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async setActive(id: string, active: boolean) {
    const staff = await this.getStaffOrThrow(id);

    if (!active && staff.isOnShift) {
      await this.finishShift(
        staff,
        'shift_ended',
        'system',
        'Зміну завершено через деактивацію працівника',
      );
    }

    staff.active = active;
    const saved = await this.staffRepo.save(staff);
    return this.toPublicStaff(saved);
  }

  async archive(id: string, dto: StaffShiftActionDto = {}) {
    const staff = await this.getStaffOrThrow(id);

    if (staff.isArchived) {
      throw new BadRequestException('Працівник уже в архіві');
    }

    if (staff.isOnShift) {
      await this.finishShift(
        staff,
        'shift_ended',
        dto.performedBy,
        'Зміну завершено перед архівуванням',
      );
    }

    staff.active = false;
    staff.isArchived = true;
    staff.archivedAt = new Date();
    staff.archivedBy = dto.performedBy?.trim() || null;

    const saved = await this.staffRepo.save(staff);

    await this.saveShiftEvent(
      saved,
      'archived',
      dto.performedBy,
      dto.comment,
    );

    return this.toPublicStaff(saved);
  }

  async restore(id: string, dto: StaffShiftActionDto = {}) {
    const staff = await this.getStaffOrThrow(id);

    if (!staff.isArchived) {
      throw new BadRequestException('Працівник не перебуває в архіві');
    }

    staff.active = true;
    staff.isArchived = false;
    staff.archivedAt = null;
    staff.archivedBy = null;

    const saved = await this.staffRepo.save(staff);

    await this.saveShiftEvent(
      saved,
      'restored',
      dto.performedBy,
      dto.comment,
    );

    return this.toPublicStaff(saved);
  }

  async remove(id: string) {
    return this.archive(id, {
      performedBy: 'system',
      comment: 'Архівовано через старий маршрут видалення',
    });
  }

  @Cron('0 0 23 * * *', { timeZone: 'Europe/Kyiv', })
  async autoEndShiftsAt23() {
    const kyivDate = this.getKyivDate();
    const staffOnShift = await this.staffRepo.find({
      where: {
        isOnShift: true,
      },
    });

    for (const staff of staffOnShift) {
      if (staff.lastAutoShiftEndDate === kyivDate) {
        continue;
      }

      staff.lastAutoShiftEndDate = kyivDate;

      await this.finishShift(
        staff,
        'shift_auto_ended',
        'system',
        'Зміну автоматично завершено о 23:00',
      );
    }
  }

  private async finishShift(
    staff: Staff,
    eventType: 'shift_ended' | 'shift_auto_ended',
    performedBy?: string,
    comment?: string,
  ) {
    staff.isOnShift = false;
    staff.shiftEndedAt = new Date();
    staff.shiftEndedBy = performedBy?.trim() || null;

    const saved = await this.staffRepo.save(staff);

    await this.saveShiftEvent(
      saved,
      eventType,
      performedBy,
      comment,
    );

    return saved;
  }

  private async saveShiftEvent(
    staff: Staff,
    eventType: StaffShiftEventType,
    performedBy?: string,
    comment?: string,
  ) {
    const event = this.shiftEventRepo.create({
      staff,
      eventType,
      performedBy: performedBy?.trim() || null,
      comment: comment?.trim() || null,
    });

    await this.shiftEventRepo.save(event);
  }

  private async getStaffOrThrow(id: string) {
    const staff = await this.staffRepo.findOne({
      where: {
        id,
      },
    });

    if (!staff) {
      throw new NotFoundException('Співробітника не знайдено');
    }

    return staff;
  }

  private toPublicStaff(staff: Staff) {
    const { pinHash, ...publicStaff } = staff;

    return {
      ...publicStaff,
      hasPin: Boolean(pinHash),
    };
  }

  private getKyivDate() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
}
