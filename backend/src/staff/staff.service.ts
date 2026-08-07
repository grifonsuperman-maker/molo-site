import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcryptjs';
import { Repository } from 'typeorm';
import { CreateStaffDto } from './dto/create-staff.dto';
import { DirectorLoginDto } from './dto/director-login.dto';
import { StaffPinLoginDto } from './dto/staff-pin-login.dto';
import { StaffShiftActionDto } from './dto/staff-shift-action.dto';
import { UpdateDirectorAccessDto } from './dto/update-director-access.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { Staff } from './entities/staff.entity';
import {
  StaffShiftEvent,
  StaffShiftEventType,
} from './entities/staff-shift-event.entity';
import type { AuthUser } from '../auth/types/auth-user.type';

const TEMPORARY_DIRECTOR_PIN = '1111';
const DIRECTOR_MAX_FAILED_ATTEMPTS = 5;
const DIRECTOR_LOCK_MINUTES = 15;

@Injectable()
export class StaffService implements OnModuleInit {
  constructor(
    @InjectRepository(Staff)
    private readonly staffRepo: Repository<Staff>,

    @InjectRepository(StaffShiftEvent)
    private readonly shiftEventRepo: Repository<StaffShiftEvent>,

    private readonly jwtService: JwtService,
  ) {}

  async onModuleInit() {
    await this.closeMissedShifts(new Date());
  }

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

  async getDirectorAccessStatus() {
    const directors = await this.staffRepo.find({
      where: {
        role: 'owner',
        active: true,
        isArchived: false,
      },
      order: {
        fullName: 'ASC',
      },
    });

    return {
      configured: directors.some((director) =>
        this.hasConfiguredDirectorAccess(director),
      ),
      bootstrapAvailable: directors.some(
        (director) => !this.hasConfiguredDirectorAccess(director),
      ),
      directors: directors.map((director) => ({
        id: director.id,
        fullName: director.fullName,
        configured: this.hasConfiguredDirectorAccess(director),
      })),
    };
  }

  async loginDirector(dto: DirectorLoginDto) {
    const temporaryPin = dto.temporaryPin?.trim();

    if (temporaryPin !== undefined || dto.staffId) {
      if (!dto.staffId || !temporaryPin) {
        throw new BadRequestException('Оберіть Директора та введіть тимчасовий PIN');
      }

      const director = await this.staffRepo.findOne({
        where: {
          id: dto.staffId,
          role: 'owner',
          active: true,
          isArchived: false,
        },
      });

      if (!director || this.hasConfiguredDirectorAccess(director)) {
        throw new UnauthorizedException('Тимчасовий доступ недоступний');
      }

      await this.assertDirectorNotLocked(director);

      if (temporaryPin !== TEMPORARY_DIRECTOR_PIN) {
        await this.registerDirectorLoginFailure(director);
      }

      await this.resetDirectorLoginProtection(director);
      return this.issueStaffToken(director, true);
    }

    const loginName = this.normalizeDirectorLogin(dto.loginName);
    const password = dto.password || '';

    if (!loginName || !password) {
      throw new BadRequestException('Введіть ім’я та пароль Директора');
    }

    const director = await this.staffRepo.findOne({
      where: {
        directorLoginName: loginName,
        role: 'owner',
        active: true,
        isArchived: false,
      },
    });

    if (!director || !director.directorPasswordHash) {
      throw new UnauthorizedException('Невірне ім’я або пароль');
    }

    await this.assertDirectorNotLocked(director);

    const passwordIsValid = await compare(
      password,
      director.directorPasswordHash,
    );

    if (!passwordIsValid) {
      await this.registerDirectorLoginFailure(director);
    }

    await this.resetDirectorLoginProtection(director);
    return this.issueStaffToken(director, false);
  }

  async getDirectorAccess(user?: AuthUser) {
    const director = await this.getAuthenticatedDirector(user);

    return {
      fullName: director.fullName,
      loginName: director.directorLoginName || '',
      configured: this.hasConfiguredDirectorAccess(director),
    };
  }

  async updateDirectorAccess(
    user: AuthUser | undefined,
    dto: UpdateDirectorAccessDto,
  ) {
    const director = await this.getAuthenticatedDirector(user);
    const configured = this.hasConfiguredDirectorAccess(director);

    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('Новий пароль і підтвердження не збігаються');
    }

    if (configured) {
      if (!dto.currentPassword || !director.directorPasswordHash) {
        throw new BadRequestException('Введіть поточний пароль');
      }

      const currentPasswordIsValid = await compare(
        dto.currentPassword,
        director.directorPasswordHash,
      );

      if (!currentPasswordIsValid) {
        throw new UnauthorizedException('Поточний пароль невірний');
      }
    }

    const loginName = this.normalizeDirectorLogin(dto.loginName);
    if (!loginName) {
      throw new BadRequestException('Вкажіть ім’я для входу');
    }

    const duplicate = await this.staffRepo.findOne({
      where: {
        directorLoginName: loginName,
      },
    });

    if (duplicate && duplicate.id !== director.id) {
      throw new ConflictException('Це ім’я для входу вже використовується');
    }

    director.fullName = dto.fullName.trim();
    director.directorLoginName = loginName;
    director.directorPasswordHash = await hash(dto.newPassword, 10);
    director.directorCredentialsConfiguredAt = new Date();
    director.directorFailedLoginAttempts = 0;
    director.directorLockedUntil = null;

    const saved = await this.staffRepo.save(director);

    return {
      fullName: saved.fullName,
      loginName: saved.directorLoginName || '',
      configured: true,
    };
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

    if (staff.role === 'owner') {
      throw new UnauthorizedException(
        'Для Директора використовуйте окремий вхід',
      );
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

    return this.issueStaffToken(staff, false);
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

    const events = await this.shiftEventRepo.find({
      where: {
        staff: {
          id,
        },
      },
      order: {
        createdAt: 'DESC',
      },
    });

    return events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      performedBy: event.performedBy,
      comment: event.comment,
      createdAt: event.createdAt,
    }));
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

  async deletePermanently(id: string) {
    const staff = await this.getStaffOrThrow(id);

    if (staff.role === 'owner') {
      throw new BadRequestException('Обліковий запис Директора не можна видалити назавжди');
    }

    if (!staff.isArchived) {
      throw new BadRequestException('Спочатку перемістіть працівника до архіву');
    }

    const deletedId = staff.id;
    await this.staffRepo.remove(staff);
    return { id: deletedId };
  }

  async remove(id: string) {
    return this.archive(id, {
      performedBy: 'system',
      comment: 'Архівовано через старий маршрут видалення',
    });
  }

  @Cron('0 * 23 * * *', { timeZone: 'Europe/Kyiv' })
  async autoEndShiftsAfter2301() {
    await this.closeMissedShifts(new Date());
  }

  async closeMissedShifts(now = new Date()) {
    const current = this.getKyivDateTime(now);
    const afterClosingTime =
      current.hour > 23 || (current.hour === 23 && current.minute >= 1);
    const staffOnShift = await this.staffRepo.find({
      where: {
        isOnShift: true,
      },
    });

    for (const staff of staffOnShift) {
      const shiftDate = staff.shiftStartedAt
        ? this.getKyivDate(staff.shiftStartedAt)
        : null;
      const carriedOver = !shiftDate || shiftDate < current.date;

      if (!afterClosingTime && !carriedOver) {
        continue;
      }

      staff.lastAutoShiftEndDate = current.date;

      await this.finishShift(
        staff,
        'shift_auto_ended',
        'system',
        'Зміну автоматично завершено після 23:01',
      );
    }
  }

  private async issueStaffToken(
    staff: Staff,
    mustConfigureDirectorAccess: boolean,
  ) {
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
      mustConfigureDirectorAccess,
    };
  }

  private async assertDirectorNotLocked(director: Staff) {
    if (!director.directorLockedUntil) return;

    const lockedUntil = new Date(director.directorLockedUntil);
    if (lockedUntil.getTime() <= Date.now()) {
      director.directorFailedLoginAttempts = 0;
      director.directorLockedUntil = null;
      await this.staffRepo.save(director);
      return;
    }

    const minutes = Math.max(
      1,
      Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000),
    );
    throw new UnauthorizedException(
      `Забагато невдалих спроб. Повторіть через ${minutes} хв.`,
    );
  }

  private async registerDirectorLoginFailure(director: Staff): Promise<never> {
    director.directorFailedLoginAttempts =
      Number(director.directorFailedLoginAttempts || 0) + 1;

    if (director.directorFailedLoginAttempts >= DIRECTOR_MAX_FAILED_ATTEMPTS) {
      director.directorLockedUntil = new Date(
        Date.now() + DIRECTOR_LOCK_MINUTES * 60_000,
      );
      await this.staffRepo.save(director);
      throw new UnauthorizedException(
        `Забагато невдалих спроб. Вхід заблоковано на ${DIRECTOR_LOCK_MINUTES} хв.`,
      );
    }

    await this.staffRepo.save(director);
    const attemptsLeft =
      DIRECTOR_MAX_FAILED_ATTEMPTS - director.directorFailedLoginAttempts;
    throw new UnauthorizedException(
      `Невірні дані входу. Залишилось спроб: ${attemptsLeft}`,
    );
  }

  private async resetDirectorLoginProtection(director: Staff) {
    if (
      !director.directorFailedLoginAttempts &&
      !director.directorLockedUntil
    ) {
      return;
    }

    director.directorFailedLoginAttempts = 0;
    director.directorLockedUntil = null;
    await this.staffRepo.save(director);
  }

  private async getAuthenticatedDirector(user?: AuthUser) {
    if (!user || user.role !== 'owner') {
      throw new UnauthorizedException('Потрібен доступ Директора');
    }

    const id = user.staffId || user.sub;
    const director = await this.staffRepo.findOne({
      where: {
        id,
        role: 'owner',
        active: true,
        isArchived: false,
      },
    });

    if (!director) {
      throw new UnauthorizedException('Директора не знайдено');
    }

    return director;
  }

  private hasConfiguredDirectorAccess(director: Staff) {
    return Boolean(
      director.directorLoginName &&
        director.directorPasswordHash &&
        director.directorCredentialsConfiguredAt,
    );
  }

  private normalizeDirectorLogin(value?: string) {
    return value?.trim().toLowerCase() || '';
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
    const {
      pinHash,
      directorPasswordHash,
      directorLoginName,
      directorCredentialsConfiguredAt,
      directorFailedLoginAttempts,
      directorLockedUntil,
      ...publicStaff
    } = staff;

    return {
      ...publicStaff,
      hasPin: Boolean(pinHash),
      hasDirectorAccess: Boolean(
        directorLoginName &&
          directorPasswordHash &&
          directorCredentialsConfiguredAt,
      ),
    };
  }

  private getKyivDate(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }

  private getKyivDateTime(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value || '';

    return {
      date: `${value('year')}-${value('month')}-${value('day')}`,
      hour: Number(value('hour')),
      minute: Number(value('minute')),
    };
  }
}
