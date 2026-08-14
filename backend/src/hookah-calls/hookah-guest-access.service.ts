import { Injectable, UnauthorizedException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { createHash } from "crypto";
import { Repository } from "typeorm";

import { Booking } from "../bookings/entities/booking.entity";

@Injectable()
export class HookahGuestAccessService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingsRepo: Repository<Booking>,
  ) {}

  async assertBookingAccess(bookingId: string, guestToken?: string) {
    const normalizedToken = String(guestToken || "").trim();
    if (!normalizedToken || normalizedToken.length > 256) {
      throw new UnauthorizedException("Недійсний доступ до бронювання");
    }

    const guestAccessTokenHash = createHash("sha256")
      .update(normalizedToken)
      .digest("hex");
    const hasAccess = await this.bookingsRepo.exist({
      where: { id: bookingId, guestAccessTokenHash },
    });

    if (!hasAccess) {
      throw new UnauthorizedException("Недійсний доступ до бронювання");
    }
  }
}
