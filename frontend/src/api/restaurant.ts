import { api } from './client'; import type { Restaurant } from './types';
export const restaurantApi={ get:()=>api.get<Restaurant>('/restaurant'), open:()=>api.post('/restaurant/open'), closeBooking:()=>api.post('/restaurant/close-booking'), close:(message?:string)=>api.post('/restaurant/close',{message}), update:(body:Partial<Restaurant>)=>api.patch('/restaurant',body) };
