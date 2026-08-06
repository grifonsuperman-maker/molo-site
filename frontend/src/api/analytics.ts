import { api } from "./client";

export type TodayAnalytics = {
  date: string;
  bookingsCount: number;
  pendingCount: number;
  guestsCount: number;
  occupiedTables: number;
  freeTables: number;
  closedZones: number;
};

export type HourlyLoad = {
  date: string;
  hours: Record<string, { bookingsCount: number; guestsCount: number }>;
};

export const analyticsApi = {
  today: () => api.get<TodayAnalytics>("/analytics/today"),
  hourlyLoad: (date: string) =>
    api.get<HourlyLoad>(
      `/analytics/hourly-load?date=${encodeURIComponent(date)}`,
    ),
};
