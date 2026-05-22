import { BadRequestException, Body, Controller, Post, Res } from "@nestjs/common";
import * as express from "express";
import { AuthService } from "./auth.service";
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE, UserRole } from "@app/common";

interface LoginRequestBody {
  role?: UserRole;
  identifier?: string;
  emailOrMobile?: string;
  password?: string;
}

@Controller("api/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("admin/login")
  async adminLogin(
    @Body() body: LoginRequestBody,
    @Res({ passthrough: true }) response: express.Response
  ) {
    return this.processLogin(body, response, "operator");
  }

  @Post("mobile/login")
  async mobileLogin(
    @Body() body: LoginRequestBody,
    @Res({ passthrough: true }) response: express.Response
  ) {
    return this.processLogin(body, response, "customer");
  }

  @Post("web/login")
  async webLogin(
    @Body() body: LoginRequestBody,
    @Res({ passthrough: true }) response: express.Response
  ) {
    return this.processLogin(body, response, "customer");
  }

  private async processLogin(
    body: LoginRequestBody,
    response: express.Response,
    defaultRole: UserRole
  ) {
    const role = body.role || defaultRole;
    const identifier = String(body.identifier ?? body.emailOrMobile ?? "").trim();
    const password = String(body.password ?? "").trim();

    if (!identifier || !password) {
      throw new BadRequestException("Identifier and password are required.");
    }

    const result = await this.authService.signIn(identifier, password, role);

    let accessToken: string | undefined = undefined;

    if (!result.requiresTwoFactor) {
      accessToken = createSessionToken(result.session);
      response.cookie(SESSION_COOKIE, accessToken, getSessionCookieOptions());
    }

    return {
      user: result.user,
      redirectPath: result.redirectPath,
      requiresTwoFactor: result.requiresTwoFactor,
      challengeToken: result.challengeToken,
      accessToken,
    };
  }
}
