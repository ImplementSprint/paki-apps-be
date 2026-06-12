import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { SessionAuthGuard } from "../common/session/session-auth.guard";
import type { SessionPayload } from "../common/session/session.types";
import { SettingsService } from "./settings.service";

function getSessionUser(request: Request) {
  return (request as Request & { user: SessionPayload }).user;
}

@Controller("settings")
@UseGuards(SessionAuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get("me")
  getMySettings(@Req() request: Request) {
    return this.settingsService.getMySettings(getSessionUser(request));
  }

  @Patch("me")
  updateMySettings(
    @Req() request: Request,
    @Body() body: Record<string, unknown>,
  ) {
    return this.settingsService.updateMySettings(getSessionUser(request), body);
  }

  @Post("change-password")
  changePassword(
    @Req() request: Request,
    @Body() body: Record<string, unknown>,
  ) {
    return this.settingsService.changePassword(getSessionUser(request), body);
  }
}
