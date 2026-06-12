import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { SessionAuthGuard } from "../common/session/session-auth.guard";
import type { SessionPayload } from "../common/session/session.types";
import { NotificationsService } from "./notifications.service";

function getSessionUser(request: Request) {
  return (request as Request & { user: SessionPayload }).user;
}

@Controller("notifications")
@UseGuards(SessionAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  listNotifications(@Req() request: Request) {
    return this.notificationsService.listForUser(getSessionUser(request));
  }

  @Post()
  createNotification(
    @Req() request: Request,
    @Body() body: Record<string, unknown>,
  ) {
    return this.notificationsService.createForUser(getSessionUser(request), body);
  }

  @Patch(":notificationId/read")
  markAsRead(
    @Req() request: Request,
    @Param("notificationId") notificationId: string,
  ) {
    return this.notificationsService.markAsRead(getSessionUser(request), notificationId);
  }

  @Post("read-all")
  markAllAsRead(@Req() request: Request) {
    return this.notificationsService.markAllAsRead(getSessionUser(request));
  }

  @Delete(":notificationId")
  deleteOne(
    @Req() request: Request,
    @Param("notificationId") notificationId: string,
  ) {
    return this.notificationsService.deleteOne(getSessionUser(request), notificationId);
  }

  @Delete()
  clearAll(@Req() request: Request) {
    return this.notificationsService.clearAll(getSessionUser(request));
  }
}
