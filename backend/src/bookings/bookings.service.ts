import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';
import { BookingRescheduleRequest } from './entities/booking-reschedule-request.entity';
import { Client } from '../clients/entities/client.entity';
import { TableEntity } from '../tables/entities/table.entity';
import { Restaurant } from '../restaurant/entities/restaurant.entity';
import { CreateBookingDto } from './dto/create-booking.dto';
import { RequestRescheduleDto } from './dto/request-reschedule.dto';
import { RejectRescheduleDto } from './dto/reject-reschedule.dto';
import { LogsService } from '../logs/logs.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(BookingRescheduleRequest) private readonly reschedules: Repository<BookingRescheduleRequest>,
    @InjectRepository(Client) private readonly clients: Repository<Client>,
    @InjectRepository(TableEntity) private readonly tables: Repository<TableEntity>,
    @InjectRepository(Restaurant) private readonly restaurants: Repository<Restaurant>,
    private readonly logs: LogsService,
    private readonly notifications: NotificationsService,
  ) {}
  async restaurant(){ const r=await this.restaurants.findOne({order:{createdAt:'ASC'}}); if(!r) throw new NotFoundException('Ресторан не знайдено'); return r; }
  async validateRestaurant(){ const r=await this.restaurant(); if(r.status==='closed') throw new BadRequestException(r.closeMessage); if(r.status==='booking_closed') throw new BadRequestException(r.bookingClosedMessage); }
  async create(dto:CreateBookingDto){
    await this.validateRestaurant();
    const table=await this.tables.findOne({where:{id:dto.tableId},relations:['zone']}); if(!table) throw new NotFoundException('Стіл не знайдено');
    if(!table.isVisible || table.status!=='free') throw new BadRequestException('Стіл зараз недоступний для онлайн-бронювання');
    if(table.zone?.isClosed || table.zone?.isVisible===false) throw new BadRequestException('Ця зона зараз закрита для бронювання');
    let client=await this.clients.findOne({where:{phone:dto.phone}});
    if(!client){ client=await this.clients.save(this.clients.create({fullName:dto.fullName, phone:dto.phone})); }
    if(client.isBlacklisted) throw new BadRequestException('Бронювання з цього номера недоступне');
    const booking=await this.bookings.save(this.bookings.create({table, client, bookingDate:dto.bookingDate, bookingTime:dto.bookingTime, guestsCount:dto.guestsCount, wishes:dto.wishes||null, status:'pending', source:'mini_app'}));
    await this.logs.create('Створено заявку на бронювання', null, {bookingId:booking.id, tableNumber:table.tableNumber, clientName:client.fullName});
    const full=await this.bookings.findOne({where:{id:booking.id},relations:['table','client']}); if(full) await this.notifications.notifyNewBooking(full);
    return {message:'Заявку на бронювання надіслано адміністратору', bookingId:booking.id, status:booking.status};
  }
  async getToday(){ const today=new Date().toISOString().slice(0,10); return this.bookings.find({where:{bookingDate:today},relations:['table','client'],order:{bookingTime:'ASC'}}); }
  async getBooking(id:string){ const b=await this.bookings.findOne({where:{id},relations:['table','client']}); if(!b) throw new NotFoundException('Бронювання не знайдено'); return b; }
  async approve(id:string){ const b=await this.getBooking(id); if(!b.table) throw new BadRequestException('Стіл не знайдено'); if(b.status!=='pending') throw new BadRequestException('Це бронювання вже оброблено'); b.status='approved'; b.approvedAt=new Date(); b.table.status='reserved'; await this.tables.save(b.table); await this.bookings.save(b); await this.logs.create('Бронювання підтверджено', null, {bookingId:b.id}); await this.notifications.notifyBookingApproved(b); return {message:'Бронювання підтверджено'}; }
  async reject(id:string){ const b=await this.getBooking(id); if(b.status!=='pending') throw new BadRequestException('Це бронювання вже оброблено'); b.status='rejected'; b.rejectedAt=new Date(); await this.bookings.save(b); await this.logs.create('Бронювання відхилено', null, {bookingId:b.id}); return {message:'Бронювання відхилено'}; }
  async cancel(id:string){ const b=await this.getBooking(id); b.status='cancelled'; b.cancelledAt=new Date(); if(b.table?.status==='reserved'){ b.table.status='free'; await this.tables.save(b.table); } if(b.client){ b.client.cancellationsCount+=1; await this.clients.save(b.client); } await this.bookings.save(b); await this.logs.create('Бронювання скасовано', null, {bookingId:b.id}); await this.notifications.notifyBookingCancelled(b); return {message:'Бронювання скасовано'}; }
  async checkIn(id:string){ const b=await this.getBooking(id); if(!b.table) throw new BadRequestException('Стіл не знайдено'); if(b.status!=='approved') throw new BadRequestException('Посадити можна тільки підтверджене бронювання'); b.table.status='occupied'; if(b.client){ b.client.visitsCount+=1; b.client.totalGuests+=b.guestsCount; b.client.lastVisitAt=new Date(); await this.clients.save(b.client); } await this.tables.save(b.table); await this.bookings.save(b); await this.logs.create('Гості прийшли', null, {bookingId:b.id}); return {message:'Гості прийшли, стіл зайнятий'}; }
  async complete(id:string){ const b=await this.getBooking(id); if(!b.table) throw new BadRequestException('Стіл не знайдено'); b.status='completed'; b.completedAt=new Date(); b.table.status='free'; await this.tables.save(b.table); await this.bookings.save(b); await this.logs.create('Стіл звільнено', null, {bookingId:b.id}); return {message:'Стіл вільний'}; }
  async requestReschedule(id:string,dto:RequestRescheduleDto){ const b=await this.getBooking(id); if(!['pending','approved'].includes(b.status)) throw new BadRequestException('Для цього бронювання не можна запросити перенесення'); const r=await this.reschedules.save(this.reschedules.create({booking:b, requestedDate:dto.requestedDate, requestedTime:dto.requestedTime, status:'pending'})); if(b.client){b.client.reschedulesCount+=1; await this.clients.save(b.client);} const full=await this.reschedules.findOne({where:{id:r.id},relations:['booking','booking.table','booking.client']}); if(full) await this.notifications.notifyRescheduleRequest(full); await this.logs.create('Гість запросив перенесення бронювання', null, {bookingId:b.id, requestId:r.id}); return {message:'Запит на перенесення надіслано адміністратору',requestId:r.id}; }
  async getPendingReschedules(){ return this.reschedules.find({where:{status:'pending'},relations:['booking','booking.table','booking.client'],order:{createdAt:'DESC'}}); }
  async approveReschedule(requestId:string){ const r=await this.reschedules.findOne({where:{id:requestId},relations:['booking','booking.table','booking.client']}); if(!r) throw new NotFoundException('Запит на перенесення не знайдено'); if(r.status!=='pending') throw new BadRequestException('Цей запит уже оброблено'); r.booking.bookingDate=r.requestedDate; r.booking.bookingTime=r.requestedTime; r.status='approved'; r.resolvedAt=new Date(); await this.bookings.save(r.booking); await this.reschedules.save(r); await this.logs.create('Перенесення бронювання підтверджено', null, {requestId:r.id}); return {message:'Перенесення бронювання підтверджено'}; }
  async rejectReschedule(requestId:string,dto:RejectRescheduleDto){ const r=await this.reschedules.findOne({where:{id:requestId},relations:['booking']}); if(!r) throw new NotFoundException('Запит на перенесення не знайдено'); r.status='rejected'; r.adminComment=dto.adminComment||null; r.resolvedAt=new Date(); await this.reschedules.save(r); await this.logs.create('Перенесення бронювання відхилено', null, {requestId:r.id}); return {message:'Перенесення бронювання відхилено'}; }
}
