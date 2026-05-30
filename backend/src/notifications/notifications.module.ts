import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Staff } from '../staff/entities/staff.entity';
import { TelegramService } from './telegram.service';
import { NotificationsService } from './notifications.service';
@Module({ imports:[TypeOrmModule.forFeature([Staff])], providers:[TelegramService,NotificationsService], exports:[TelegramService,NotificationsService] })
export class NotificationsModule {}
