import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import type { AuthUser } from "../auth/types/auth-user.type";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { AcceptHookahCallDto } from "./dto/accept-hookah-call.dto";
import { CancelHookahCallDto } from "./dto/cancel-hookah-call.dto";
import { CreateHookahCallDto } from "./dto/create-hookah-call.dto";
import { UpdateHookahAvailabilityDto } from "./dto/update-hookah-availability.dto";
import { HookahCallsService } from "./hookah-calls.service";

type AuthenticatedRequest = Request & {
  user: AuthUser;
};

@Controller("hookah-calls")
export class HookahCallsController {
  constructor(private readonly service: HookahCallsService) {}

  @Public()
  @Get("guest/:bookingId/status")
  guestStatus(@Param("bookingId") bookingId: string) {
    return this.service.guestStatus(bookingId);
  }

  @Public()
  @Get("availability")
  availability() {
    return this.service.availability();
  }

  @Roles("hookah")
  @Post("availability")
  setAvailability(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateHookahAvailabilityDto,
  ) {
    return this.service.setAvailability(request.user.staffId!, dto.available);
  }

  @Public()
  @Post("guest")
  createFromGuest(@Body() dto: CreateHookahCallDto) {
    return this.service.createFromGuest(dto);
  }

  @Roles("hookah", "admin", "owner")
  @Get("active")
  listActive() {
    return this.service.listActive();
  }

  @Roles("hookah")
  @Get("mine")
  listMine(@Req() request: AuthenticatedRequest) {
    return this.service.listMine(request.user.staffId!);
  }

  @Roles("hookah")
  @Post(":id/accept")
  accept(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: AcceptHookahCallDto,
  ) {
    return this.service.accept(id, request.user.staffId!, dto);
  }

  @Roles("hookah")
  @Post(":id/complete")
  complete(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.service.complete(id, request.user.staffId!);
  }

  @Roles("admin", "owner")
  @Post(":id/cancel")
  cancel(@Param("id") id: string, @Body() dto: CancelHookahCallDto) {
    return this.service.cancel(id, dto);
  }
}
