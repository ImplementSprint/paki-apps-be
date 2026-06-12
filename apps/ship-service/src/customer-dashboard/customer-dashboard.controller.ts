import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { SessionAuthGuard } from "../common/session/session-auth.guard";
import type { SessionPayload } from "../common/session/session.types";
import { CustomerDashboardService } from "./customer-dashboard.service";

function getSessionUser(request: Request) {
  return (request as Request & { user: SessionPayload }).user;
}

@Controller("customer")
@UseGuards(SessionAuthGuard)
export class CustomerDashboardController {
  constructor(private readonly customerDashboardService: CustomerDashboardService) {}

  @Get("dashboard/active-deliveries")
  getActiveDeliveries(
    @Req() request: Request,
    @Query("search") search?: string,
    @Query("status") status?: string,
  ) {
    return this.customerDashboardService.getActiveDeliveries(getSessionUser(request), {
      search,
      status,
    });
  }

  @Get("dashboard/announcements")
  getAnnouncements(@Req() request: Request) {
    return this.customerDashboardService.getAnnouncements(getSessionUser(request));
  }

  @Get("reviews")
  getRecentReviews(@Req() request: Request, @Query("limit") limit?: string) {
    return this.customerDashboardService.getRecentReviews(getSessionUser(request), limit);
  }

  @Post("reviews")
  submitReview(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.customerDashboardService.submitReview(getSessionUser(request), {
      trackingNumber: String(body.trackingNumber ?? ""),
      rating: Number(body.rating ?? 0),
      review: body.review ? String(body.review) : undefined,
      tags: Array.isArray(body.tags) ? body.tags.map((value) => String(value)) : undefined,
    });
  }

  @Get("settings/preferences")
  getPreferences(@Req() request: Request) {
    return this.customerDashboardService.getPreferences(getSessionUser(request));
  }

  @Patch("settings/preferences")
  updatePreferences(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.customerDashboardService.updatePreferences(getSessionUser(request), {
      emailNotifications:
        typeof body.emailNotifications === "boolean" ? body.emailNotifications : undefined,
      smsUpdates: typeof body.smsUpdates === "boolean" ? body.smsUpdates : undefined,
      autoExtend: typeof body.autoExtend === "boolean" ? body.autoExtend : undefined,
    });
  }
}
