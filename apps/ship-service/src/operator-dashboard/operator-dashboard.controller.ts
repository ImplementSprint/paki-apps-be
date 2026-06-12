import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { SessionAuthGuard } from "../common/session/session-auth.guard";
import type { SessionPayload } from "../common/session/session.types";
import { OperatorDashboardService } from "./operator-dashboard.service";

function getSessionUser(request: Request) {
  return (request as Request & { user: SessionPayload }).user;
}

@Controller("operator/dashboard")
@UseGuards(SessionAuthGuard)
export class OperatorDashboardController {
  constructor(private readonly operatorDashboardService: OperatorDashboardService) {}

  @Get()
  getDashboard(@Req() request: Request) {
    return this.operatorDashboardService.getDashboard(getSessionUser(request));
  }

  @Get("parcels")
  getParcels(@Req() request: Request) {
    return this.operatorDashboardService.getParcels(getSessionUser(request));
  }

  @Get("reports")
  getReports(@Req() request: Request) {
    return this.operatorDashboardService.getReports(getSessionUser(request));
  }

  @Get("drop-off-point-profile")
  getDropOffPointProfile(@Req() request: Request) {
    return this.operatorDashboardService.getDropOffPointProfile(getSessionUser(request));
  }

  @Patch("drop-off-point-profile")
  updateDropOffPointProfile(
    @Req() request: Request,
    @Body() body: Record<string, unknown>,
  ) {
    return this.operatorDashboardService.updateDropOffPointProfile(
      getSessionUser(request),
      body,
    );
  }

  @Post("manual-entry")
  manualEntry(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.operatorDashboardService.registerManualEntry(
      getSessionUser(request),
      String(body.trackingNumber ?? ""),
    );
  }

  @Post("reports/lost-parcel")
  reportLostParcel(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.operatorDashboardService.reportLostParcel(
      getSessionUser(request),
      String(body.trackingNumber ?? ""),
      String(body.details ?? ""),
    );
  }

  @Patch("parcel-records/:recordId/status")
  updateParcelStatus(
    @Req() request: Request,
    @Param("recordId") recordId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.operatorDashboardService.updateParcelStatus(
      getSessionUser(request),
      recordId,
      String(body.status ?? ""),
    );
  }

  @Get("relay-bookings")
  getRelayBookings(@Req() request: Request) {
    return this.operatorDashboardService.getRelayBookings(getSessionUser(request));
  }

  @Patch("relay-bookings/:draftId/status")
  updateRelayBookingStatus(
    @Req() request: Request,
    @Param("draftId") draftId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.operatorDashboardService.updateRelayBookingStatus(
      getSessionUser(request),
      draftId,
      {
        currentLocation: body.currentLocation,
        progressLabel: body.progressLabel,
        progressPercentage: body.progressPercentage,
      },
    );
  }
}
