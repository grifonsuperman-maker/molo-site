export type RestaurantStatus = 'open' | 'booking_closed' | 'closed';
export type SiteMode = 'day' | 'night' | 'holiday';
export type HolidayKey =
  | 'new-year'
  | 'christmas'
  | 'valentines'
  | 'easter'
  | 'halloween'
  | 'march-8';
export type TableStatus = 'free' | 'pending' | 'reserved' | 'occupied' | 'cleaning' | 'closed';
export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed';

export type Restaurant = {
  id: string;
  name: string;
  phone: string | null;
  adminCanManageZones?: boolean;
  adminCanManageOnlineBooking?: boolean;
  adminCanManageRestaurant?: boolean;
  adminCanChangeSiteMode?: boolean;
  adminCanEditRestaurantSettings?: boolean;
  adminCanManageBlacklist?: boolean;
  adminCanRespondReviews?: boolean;
  adminCanManageStaffShifts?: boolean;
  adminCanSendBroadcasts?: boolean;
  menuUrl: string | null;
  status: RestaurantStatus;
  siteMode?: SiteMode;
  holidayKey?: HolidayKey | null;
  closeMessage: string;
  bookingClosedMessage: string;
  mapWidth?: number;
  mapHeight?: number;
};

export type Zone = {
  id: string;
  name: string;
  color: string | null;
  photoUrl: string | null;
  description: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  isClosed: boolean;
  isVisible: boolean;
};

export type TableItem = {
  id: string;
  tableNumber: string;
  seats: number;
  shape: string;
  photoUrl: string | null;
  status: TableStatus;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  isVisible: boolean;
  zone?: Zone | null;
};

export type Client = {
  id: string;
  fullName: string;
  phone: string;
  visitsCount: number;
  totalGuests: number;
  isRegular: boolean;
  isBlacklisted: boolean;
  blacklistReason?: string | null;
  blacklistedAt?: string | null;
};

export type Booking = {
  id: string;
  table: TableItem | null;
  client: Client | null;
  bookingDate: string;
  bookingTime: string;
  durationMinutes?: number;
  departureTime?: string | null;
  cleanupMinutes?: number;
  availableFrom?: string | null;
  arrivalGraceUntil?: string | null;
  waitExtendedUntil?: string | null;
  waitExtendedCount?: number;
  checkedInAt?: string | null;
  assignedWaiterId?: string | null;
  assignedWaiterName?: string | null;
  noShowAlertSentAt?: string | null;
  guestsCount: number;
  wishes: string | null;
  status: BookingStatus;
  source: 'mini_app' | 'phone' | 'admin_manual';
  approvedAt?: string | null;
  rejectedAt?: string | null;
  cancelledAt?: string | null;
  completedAt?: string | null;
  lateNotifiedAt?: string | null;
  createdAt: string;
};

export type MapObject = {
  id: string;
  objectType: string;
  name: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color: string | null;
  isVisible: boolean;
  zone?: Zone | null;
};

export type FullMapResponse = {
  restaurant: Restaurant;
  zones: Zone[];
  tables: TableItem[];
  objects: MapObject[];
};
