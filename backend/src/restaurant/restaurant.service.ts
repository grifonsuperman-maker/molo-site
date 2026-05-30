import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Restaurant } from './entities/restaurant.entity';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { CloseRestaurantDto } from './dto/close-restaurant.dto';
import { LogsService } from '../logs/logs.service';

@Injectable()
export class RestaurantService {
  constructor(@InjectRepository(Restaurant) private readonly repo: Repository<Restaurant>, private readonly logs: LogsService) {}
  async getRestaurant(){ const r=await this.repo.findOne({ order:{ createdAt:'ASC' }}); if(!r) throw new NotFoundException('Ресторан не знайдено'); return r; }
  getSettings(){ return this.getRestaurant(); }
  async update(dto: UpdateRestaurantDto){ const r=await this.getRestaurant(); Object.assign(r,dto); await this.repo.save(r); await this.logs.create('Оновлено налаштування ресторану', null, dto as any); return { message:'Налаштування ресторану оновлено', restaurant:r}; }
  async openRestaurant(){ const r=await this.getRestaurant(); r.status='open'; await this.repo.save(r); await this.logs.create('Ресторан відкрито'); return { message:'Ресторан відкрито', status:r.status}; }
  async closeBooking(){ const r=await this.getRestaurant(); r.status='booking_closed'; await this.repo.save(r); await this.logs.create('Онлайн-бронювання закрито'); return { message:'Онлайн-бронювання закрито', status:r.status}; }
  async closeRestaurant(dto: CloseRestaurantDto){ const r=await this.getRestaurant(); if(dto.message) r.closeMessage=dto.message; r.status='closed'; await this.repo.save(r); await this.logs.create('Ресторан повністю закрито', null, {message:r.closeMessage}); return { message:'Ресторан повністю закрито', status:r.status, closeMessage:r.closeMessage}; }
}
