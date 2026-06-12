import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { SessionAuthGuard } from "../common/session/session-auth.guard";
import type { SessionPayload } from "../common/session/session.types";
import { DriverDashboardService } from "./driver-dashboard.service";

function getSessionUser(request: Request) {
  return (request as Request & { user: SessionPayload }).user;
}

@Controller("driver/dashboard")
@UseGuards(SessionAuthGuard)
export class DriverDashboardController {
  constructor(private readonly driverDashboardService: DriverDashboardService) {}

  @Get()
  getDashboard(@Req() request: Request, @Query() query: Record<string, unknown>) {
    return this.driverDashboardService.getDashboard(getSessionUser(request), query);
  }

  @Patch("presence")
  updatePresence(@Req() request: Request, @Body() body: Record<string, unknown>) {
    if (typeof body.isOnline !== "boolean") {
      throw new BadRequestException("The online status must be provided.");
    }

    return this.driverDashboardService.updatePresence(
      getSessionUser(request),
      body.isOnline,
      body,
    );
  }

  @Post("jobs/:jobId/accept")
  acceptJob(@Req() request: Request, @Param("jobId") jobId: string) {
    return this.driverDashboardService.acceptJob(getSessionUser(request), jobId);
  }

  @Post("jobs/:jobId/status")
  updateParcelStatus(
    @Req() request: Request,
    @Param("jobId") jobId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const parcelStatus = String(body.parcelStatus ?? "");
    return this.driverDashboardService.updateParcelStatus(
      getSessionUser(request),
      jobId,
      parcelStatus,
      body,
    );
  }
}
