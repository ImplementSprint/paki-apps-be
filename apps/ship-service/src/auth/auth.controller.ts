import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UploadedFiles,
  UseInterceptors,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { AuthService } from "./auth.service";
import { SessionAuthGuard } from "../common/session/session-auth.guard";
import {
  createSessionToken,
  getSessionCookieOptions,
  parseCookieHeader,
  readSessionToken,
  SESSION_COOKIE,
} from "../common/session/session.util";
import type { SessionPayload, UserRole } from "../common/session/session.types";

function getSessionUser(request: Request) {
  return (request as Request & { user: SessionPayload }).user;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  async login(
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const identifier = String(body.identifier ?? "");
    const password = String(body.password ?? "");

    if (!identifier || !password) {
      throw new BadRequestException("Identifier and password are required.");
    }

    const result = await this.authService.signIn(identifier, password);
    const requiresTwoFactor = "requiresTwoFactor" in result && result.requiresTwoFactor;

    if (!requiresTwoFactor) {
      response.cookie(
        SESSION_COOKIE,
        createSessionToken(result.session),
        getSessionCookieOptions(),
      );
    }

    return {
      user: result.user,
      redirectPath: result.redirectPath,
      requiresTwoFactor,
      challengeToken:
        requiresTwoFactor && "challengeToken" in result ? result.challengeToken : undefined,
    };
  }

  @Post("login/verify-2fa")
  async verifyTwoFactor(
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const challengeToken = String(body.challengeToken ?? "");
    const code = String(body.code ?? "");

    if (!challengeToken || !code) {
      throw new BadRequestException("Challenge token and verification code are required.");
    }

    const result = await this.authService.verifyTwoFactorLogin(challengeToken, code);
    response.cookie(
      SESSION_COOKIE,
      createSessionToken(result.session),
      getSessionCookieOptions(),
    );

    return {
      user: result.user,
      redirectPath: result.redirectPath,
    };
  }

  @Post("verify-email")
  async verifyEmail(
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const otpToken = String(body.otpToken ?? "");
    const otp = String(body.otp ?? "");

    if (!otpToken || !otp) {
      throw new BadRequestException("Verification token and code are required.");
    }

    const result = await this.authService.verifyAccountEmail({ otpToken, otp });
    response.cookie(
      SESSION_COOKIE,
      createSessionToken(result.session),
      getSessionCookieOptions(),
    );

    return {
      user: result.user,
      redirectPath: result.redirectPath,
      message: "Account verified successfully.",
    };
  }

  @Post("signup")
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: "driverLicense", maxCount: 1 },
      { name: "vehicleRegistration", maxCount: 1 },
      { name: "driverIdSelfie", maxCount: 1 },
      { name: "medicalCertificate", maxCount: 1 },
      { name: "operatorRegistration", maxCount: 1 },
      { name: "businessPermit", maxCount: 1 },
      { name: "proofOfLocation", maxCount: 1 },
    ]),
  )
  async signup(
    @Body() body: Record<string, unknown>,
    @UploadedFiles()
    files: Record<
      string,
      Array<{
        originalname: string;
        mimetype: string;
        size: number;
        buffer: Buffer;
      }>
    > = {},
    @Res({ passthrough: true }) response: Response,
  ) {
    const requiredFields = ["email", "phone", "dob", "password", "role", "address", "city", "province"] as const;

    for (const field of requiredFields) {
      if (!body[field]) {
        throw new BadRequestException(`Missing required field: ${field}`);
      }
    }

    const fullName = String(
      body.fullName ??
        `${String(body.firstName ?? "").trim()} ${String(body.lastName ?? "").trim()}`,
    ).trim();

    if (!fullName) {
      throw new BadRequestException("Missing required field: fullName");
    }

    const result = await this.authService.createUser({
      fullName,
      email: String(body.email),
      phone: String(body.phone),
      dob: String(body.dob),
      password: String(body.password),
      role: body.role as UserRole,
      address: String(body.address),
      city: String(body.city),
      province: String(body.province),
      documents: [
        { field: "driverLicense", documentType: "driver_license" },
        { field: "vehicleRegistration", documentType: "registration" },
        { field: "driverIdSelfie", documentType: "id" },
        { field: "medicalCertificate", documentType: "medical_certificate" },
        { field: "operatorRegistration", documentType: "land_use_or_cr" },
        { field: "businessPermit", documentType: "business_permit" },
        { field: "proofOfLocation", documentType: "land_use_or_cr" },
      ].flatMap(({ field, documentType }) =>
        (files[field] ?? []).map((file) => ({
          documentType,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          buffer: file.buffer,
        })),
      ),
    });

    if ("session" in result && result.session) {
      response.cookie(
        SESSION_COOKIE,
        createSessionToken(result.session),
        getSessionCookieOptions(),
      );
    }

    return {
      user: result.user,
      redirectPath: result.redirectPath,
      requiresVerification: result.requiresVerification,
      otpToken: result.otpToken,
      message: result.message,
    };
  }

  @Get("application-status")
  @UseGuards(SessionAuthGuard)
  getApplicationStatus(@Req() request: Request) {
    return this.authService.getApplicationStatus(getSessionUser(request));
  }

  @Post("forgot-password")
  async forgotPassword(@Body() body: Record<string, unknown>) {
    const identifier = String(body.identifier ?? "");

    if (!identifier) {
      throw new BadRequestException("Identifier is required.");
    }

    return this.authService.sendPasswordReset(identifier);
  }

  @Post("reset-password")
  async resetPassword(@Body() body: Record<string, unknown>) {
    const otpToken = String(body.otpToken ?? "");
    const otp = String(body.otp ?? "");
    const newPassword = String(body.newPassword ?? "");

    if (!otpToken || !otp || !newPassword) {
      throw new BadRequestException("Reset token, code, and new password are required.");
    }

    return this.authService.resetPasswordWithOtp({
      otpToken,
      otp,
      newPassword,
    });
  }

  @Post("change-password")
  @UseGuards(SessionAuthGuard)
  changePassword(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.authService.changePassword(
      getSessionUser(request),
      String(body.currentPassword ?? ""),
      String(body.newPassword ?? ""),
    );
  }

  @Post("two-factor/setup")
  @UseGuards(SessionAuthGuard)
  setupTwoFactor(@Req() request: Request) {
    return this.authService.setupTwoFactor(getSessionUser(request));
  }

  @Post("two-factor/enable")
  @UseGuards(SessionAuthGuard)
  enableTwoFactor(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.authService.enableTwoFactor(
      getSessionUser(request),
      String(body.code ?? ""),
    );
  }

  @Post("two-factor/disable")
  @UseGuards(SessionAuthGuard)
  disableTwoFactor(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.authService.disableTwoFactor(
      getSessionUser(request),
      String(body.code ?? ""),
    );
  }

  @Get("session")
  getSession(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const cookies = parseCookieHeader(request.headers.cookie);
    const session = readSessionToken(cookies[SESSION_COOKIE]);

    if (!session) {
      response.status(401);
      return { authenticated: false };
    }

    return {
      authenticated: true,
      user: session,
    };
  }
}
