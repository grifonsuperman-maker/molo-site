import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { Client } from '../clients/entities/client.entity';
import { TableEntity } from '../tables/entities/table.entity';
import { Zone } from '../zones/entities/zone.entity';
@Injectable()
export class AnalyticsService {
  constructor(@InjectRepository(Booking) private readonly bookings:Repository<Booking>, @InjectRepository(Client) private readonly clients:Repository<Client>, @InjectRepository(TableEntity) private readonly tables:Repository<TableEntity>, @InjectRepository(Zone) private readonly zones:Repository<Zone>) {}
  todayStr(){ return new Date().toISOString().slice(0,10); }
  range(from?:string,to?:string){ const t=this.todayStr(); return {from:from||t,to:to||t}; }
  async getToday(){ const today=this.todayStr(); const bookings=await this.bookings.find({where:{bookingDate:today},relations:['table','client']}); return {date:today, bookingsCount:bookings.length, pendingCount:bookings.filter(b=>b.status==='pending').length, guestsCount:bookings.filter(b=>['approved','completed'].includes(b.status)).reduce((s,b)=>s+b.guestsCount,0), occupiedTables:await this.tables.count({where:{status:'occupied'}}), freeTables:await this.tables.count({where:{status:'free'}}), closedZones:await this.zones.count({where:{isClosed:true}})}; }
  async getSummary(from?:string,to?:string){ const r=this.range(from,to); const bookings=await this.bookings.find({where:{bookingDate:Between(r.from,r.to)}}); return {from:r.from,to:r.to,bookingsCount:bookings.length,guestsCount:bookings.filter(b=>['approved','completed'].includes(b.status)).reduce((s,b)=>s+b.guestsCount,0),cancelledCount:bookings.filter(b=>b.status==='cancelled').length}; }
  async getPopularTables(from?:string,to?:string){ const r=this.range(from,to); return this.bookings.createQueryBuilder('booking').leftJoin('booking.table','table').select('table.id','tableId').addSelect('table.tableNumber','tableNumber').addSelect('COUNT(booking.id)','bookingsCount').addSelect('SUM(booking.guestsCount)','guestsCount').where('booking.bookingDate BETWEEN :from AND :to',r).andWhere('booking.status IN (:...statuses)',{statuses:['approved','completed']}).groupBy('table.id').addGroupBy('table.tableNumber').orderBy('COUNT(booking.id)','DESC').limit(20).getRawMany(); }
  async getPopularZones(from?:string,to?:string){ const r=this.range(from,to); return this.bookings.createQueryBuilder('booking').leftJoin('booking.table','table').leftJoin('table.zone','zone').select('zone.id','zoneId').addSelect('zone.name','zoneName').addSelect('COUNT(booking.id)','bookingsCount').addSelect('SUM(booking.guestsCount)','guestsCount').where('booking.bookingDate BETWEEN :from AND :to',r).andWhere('booking.status IN (:...statuses)',{statuses:['approved','completed']}).groupBy('zone.id').addGroupBy('zone.name').orderBy('COUNT(booking.id)','DESC').getRawMany(); }
  getRegularClients(){ return this.clients.find({where:{isBlacklisted:false},order:{visitsCount:'DESC', totalGuests:'DESC'},take:100}); }
  async getHourlyLoad(date?:string){ const d=date||this.todayStr(); const bookings=await this.bookings.find({where:{bookingDate:d}}); const hours:Record<string,{bookingsCount:number;guestsCount:number}>={}; for(const b of bookings){ if(!['approved','completed'].includes(b.status)) continue; const h=b.bookingTime.slice(0,2)+':00'; hours[h] ||= {bookingsCount:0,guestsCount:0}; hours[h].bookingsCount++; hours[h].guestsCount += b.guestsCount; } return {date:d,hours}; }
}
