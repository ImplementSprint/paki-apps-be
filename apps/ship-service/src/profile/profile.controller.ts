import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type { Request } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { SessionAuthGuard } from "../common/session/session-auth.guard";
import type { SessionPayload } from "../common/session/session.types";
import { ProfileService } from "./profile.service";

function getSessionUser(request: Request) {
  return (request as Request & { user: SessionPayload }).user;
}

@Controller("profile")
@UseGuards(SessionAuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get("me")
  getMyProfile(@Req() request: Request) {
    return this.profileService.getMyProfile(getSessionUser(request));
  }

  @Patch("me")
  updateMyProfile(
    @Req() request: Request,
    @Body() body: Record<string, unknown>,
  ) {
    return this.profileService.updateMyProfile(getSessionUser(request), body);
  }

  @Post("me/driver-documents/:documentType")
  @UseInterceptors(FileInterceptor("file"))
  uploadDriverDocument(
    @Req() request: Request,
    @Param("documentType") documentType: string,
    @UploadedFile() file?: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
  ) {
    return this.profileService.uploadDriverDocument(
      getSessionUser(request),
      documentType,
      file,
    );
  }

  @Post("me/operator-documents/:documentType")
  @UseInterceptors(FileInterceptor("file"))
  uploadOperatorDocument(
    @Req() request: Request,
    @Param("documentType") documentType: string,
    @UploadedFile() file?: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
  ) {
    return this.profileService.uploadOperatorDocument(
      getSessionUser(request),
      documentType,
      file,
    );
  }
}
