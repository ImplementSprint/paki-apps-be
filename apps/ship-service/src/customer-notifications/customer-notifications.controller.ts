import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { SessionAuthGuard } from "../common/session/session-auth.guard";
import type { SessionPayload } from "../common/session/session.types";
import { CustomerNotificationsService } from "./customer-notifications.service";

function getSessionUser(request: Request) {
  return (request as Request & { user: SessionPayload }).user;
}

@Controller("customer/notifications")
@UseGuards(SessionAuthGuard)
export class CustomerNotificationsController {
  constructor(private readonly customerNotificationsService: CustomerNotificationsService) {}

  @Get()
  list(@Req() request: Request) {
    return this.customerNotificationsService.listNotifications(getSessionUser(request));
  }

  @Patch("read-all")
  markAllAsRead(@Req() request: Request) {
    return this.customerNotificationsService.markAllAsRead(getSessionUser(request));
  }

  @Patch(":notificationId/read")
  markAsRead(
    @Req() request: Request,
    @Param("notificationId") notificationId: string,
  ) {
    return this.customerNotificationsService.markAsRead(
      getSessionUser(request),
      notificationId,
    );
  }

  @Delete()
  clearAll(@Req() request: Request) {
    return this.customerNotificationsService.clearAll(getSessionUser(request));
  }
}
