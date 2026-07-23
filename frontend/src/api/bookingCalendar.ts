import { api } from './client';

export type BookingCalendarDay = {
  date: string;
  total: number;
  pending: number;
  approved: number;
  guests: number;
};

export type UpcomingBookingCalendar = {
  today: string;
  endDate: string;
  days: number;
  total: number;
  pending: number;
  approved: number;
  dates: BookingCalendarDay[];
};

export const bookingCalendarApi = {
  upcoming: (days = 180) =>
    api.get<UpcomingBookingCalendar>(
      `/bookings-calendar/upcoming?days=${encodeURIComponent(String(days))}`,
    ),
};
