import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { parseCookieHeader, readSessionToken, SESSION_COOKIE } from "./session.util";
import { SupabaseService } from "../../supabase/supabase.service";

const REQUIRED_APPLICATION_DOCUMENT_TYPES = {
  driver: ["driver_license", "registration", "id"],
  operator: ["land_use_or_cr", "business_permit"],
} as const;

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const cookies = parseCookieHeader(request.headers.cookie);
    const session = readSessionToken(cookies[SESSION_COOKIE]);

    if (!session) {
      throw new UnauthorizedException("You must be logged in to access this resource.");
    }

    request.user = session;
    await this.assertApprovedDashboardAccess(request.originalUrl ?? request.url ?? "", session);
    return true;
  }

  private async assertApprovedDashboardAccess(
    requestUrl: string,
    session: { userId: string; role: string },
  ) {
    if (
      (session.role !== "driver" && session.role !== "operator") ||
      !requestUrl.includes(`/${session.role}/dashboard`)
    ) {
      return;
    }

    const requiredDocumentTypes =
      REQUIRED_APPLICATION_DOCUMENT_TYPES[session.role];
    const admin = this.supabaseService.createAdminClient();
    const { data, error } = await admin
      .schema("account")
      .from("document_verifications")
      .select("document_type, status")
      .eq("profile_id", session.userId)
      .in("document_type", [...requiredDocumentTypes]);

    if (error) {
      throw new ForbiddenException("Application approval must be verified before dashboard access.");
    }

    const approvedTypes = new Set(
      (data ?? [])
        .filter((row) => String(row.status ?? "").toLowerCase() === "approved")
        .map((row) => String(row.document_type ?? "")),
    );

    if (!requiredDocumentTypes.every((type) => approvedTypes.has(type))) {
      throw new ForbiddenException("Your application is still waiting for PakiAdmin approval.");
    }
  }
}
