import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomInt, randomUUID } from "crypto";
import { SupabaseService } from "../supabase/supabase.service";
import type { SessionPayload, UserRole } from "../common/session/session.types";
import { EmailService } from "./email.service";
import {
  buildOtpAuthUri,
  createTwoFactorChallengeToken,
  generateTwoFactorSecret,
  readTwoFactorChallengeToken,
  verifyTotpToken,
} from "./two-factor.util";

type SignupInput = {
  fullName: string;
  email: string;
  phone: string;
  dob: string;
  password: string;
  role: UserRole;
  address: string;
  city: string;
  province: string;
  documents?: SignupDocumentInput[];
};

type SignupDocumentInput = {
  documentType: string;
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
};

type ApplicationDocumentRow = {
  document_type: string | null;
  status: string | null;
};

type OtpPurpose =
  | "account_verification"
  | "password_reset"
  | "two_factor_login"
  | "two_factor_enable"
  | "two_factor_disable";

type OtpRecord = {
  id: string;
  email: string;
  role: UserRole;
  userId: string;
  purpose: OtpPurpose;
  otpHash: string;
  expiresAt: number;
};

function isUserRole(value: string): value is UserRole {
  return value === "customer" || value === "driver" || value === "operator";
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "").slice(-10);
}

function splitFullName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

function joinName(firstName: unknown, lastName: unknown) {
  return [firstName, lastName]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ");
}

function getRedirectPath(role: UserRole) {
  if (role === "driver") return "/driver/home";
  if (role === "operator") return "/operator/home";
  return "/customer/home";
}

const APPLICATION_REVIEW_PATH = "/application/waiting";
const REQUIRED_APPLICATION_DOCUMENT_TYPES: Record<"driver" | "operator", string[]> = {
  driver: ["driver_license", "registration", "id"],
  operator: ["land_use_or_cr", "business_permit"],
};
const APPLICATION_DOCUMENT_ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const MAX_APPLICATION_DOCUMENT_SIZE_BYTES = 8 * 1024 * 1024;

const PASSWORD_REGEX = /^(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;
const OTP_TTL_MS = 15 * 60 * 1000;
const otpStore = new Map<string, OtpRecord>();

function isMissingProfileColumnError(message?: string | null) {
  const normalized = String(message ?? "").toLowerCase();
  return (
    normalized.includes("column") &&
    (normalized.includes("city") ||
      normalized.includes("province") ||
      normalized.includes("documents"))
  );
}

@Injectable()
export class AuthService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly emailService: EmailService,
  ) {}

  private createOtp() {
    return String(randomInt(0, 1_000_000)).padStart(6, "0");
  }

  private hashOtp(otp: string) {
    return createHash("sha256").update(otp).digest("hex");
  }

  private saveOtp(input: {
    email: string;
    role: UserRole;
    userId: string;
    purpose: OtpPurpose;
    otp: string;
  }) {
    const record: OtpRecord = {
      id: randomUUID(),
      email: input.email,
      role: input.role,
      userId: input.userId,
      purpose: input.purpose,
      otpHash: this.hashOtp(input.otp),
      expiresAt: Date.now() + OTP_TTL_MS,
    };

    for (const [key, value] of otpStore.entries()) {
      if (
        value.email === input.email &&
        value.role === input.role &&
        value.purpose === input.purpose
      ) {
        otpStore.delete(key);
      }
    }

    otpStore.set(record.id, record);
    return record.id;
  }

  private verifyStoredOtp(input: {
    otpToken: string;
    otp: string;
    purpose: OtpPurpose;
  }) {
    const record = otpStore.get(input.otpToken);
    if (!record || record.purpose !== input.purpose) {
      throw new UnauthorizedException("Invalid or expired verification code.");
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(input.otpToken);
      throw new UnauthorizedException("Verification code has expired.");
    }

    if (record.otpHash !== this.hashOtp(input.otp.trim())) {
      throw new UnauthorizedException("Invalid verification code.");
    }

    otpStore.delete(input.otpToken);
    return record;
  }

  async changePassword(
    session: SessionPayload,
    currentPassword: string,
    newPassword: string,
  ) {
    if (!currentPassword || !newPassword) {
      throw new BadRequestException("Current and new passwords are required.");
    }

    if (!PASSWORD_REGEX.test(newPassword)) {
      throw new BadRequestException(
        "New password must be at least 8 characters and include a number and special character.",
      );
    }

    const admin = this.supabaseService.createAdminClient();
    const supabase = this.supabaseService.createServerClient();

    const { data: profile, error: profileError } = await admin
      .schema("account")
      .from("profiles")
      .select("email")
      .eq("id", session.userId)
      .single();

    if (profileError || !profile?.email) {
      throw new NotFoundException("Profile not found.");
    }

    const signInResult = await supabase.auth.signInWithPassword({
      email: profile.email,
      password: currentPassword,
    });

    if (signInResult.error || !signInResult.data.user) {
      throw new UnauthorizedException("Current password is incorrect.");
    }

    const updateAuthResult = await admin.auth.admin.updateUserById(session.userId, {
      password: newPassword,
    });

    if (updateAuthResult.error) {
      throw new InternalServerErrorException("Unable to update your password right now.");
    }

    return {
      success: true,
      passwordUpdatedAt: null,
    };
  }

  async setupTwoFactor(session: SessionPayload) {
    const admin = this.supabaseService.createAdminClient();
    const [profileResponse, authUserResponse] = await Promise.all([
      admin
        .schema("account")
        .from("profiles")
        .select("email, two_factor_enabled")
        .eq("id", session.userId)
        .single(),
      admin.auth.admin.getUserById(session.userId),
    ]);

    const profile = profileResponse.data;
    const currentMetadata = authUserResponse.data.user?.user_metadata ?? {};

    if (profileResponse.error || !profile?.email) {
      throw new NotFoundException("Profile not found.");
    }

    if (profile.two_factor_enabled) {
      return {
        twoFactorEnabled: true,
      };
    }

    const secret = generateTwoFactorSecret();
    const authUpdate = await admin.auth.admin.updateUserById(session.userId, {
      user_metadata: {
        ...currentMetadata,
        two_factor_pending_secret: secret,
      },
    });

    if (authUpdate.error) {
      throw new InternalServerErrorException("Unable to prepare two-factor authentication.");
    }

    return {
      secret,
      otpauthUri: buildOtpAuthUri(secret, profile.email),
      twoFactorEnabled: false,
    };
  }

  async enableTwoFactor(session: SessionPayload, code: string) {
    const admin = this.supabaseService.createAdminClient();
    const userResponse = await admin.auth.admin.getUserById(session.userId);
    const metadata = userResponse.data.user?.user_metadata ?? {};
    const pendingSecret = metadata.two_factor_pending_secret;

    if (typeof pendingSecret !== "string" || pendingSecret.length === 0) {
      throw new BadRequestException("Start the two-factor setup first.");
    }

    if (!verifyTotpToken(pendingSecret, code)) {
      throw new UnauthorizedException("Invalid authenticator code.");
    }

    const authUpdate = await admin.auth.admin.updateUserById(session.userId, {
      user_metadata: {
        ...metadata,
        two_factor_secret: pendingSecret,
        two_factor_pending_secret: null,
      },
    });

    if (authUpdate.error) {
      throw new InternalServerErrorException("Unable to enable two-factor authentication.");
    }

    const { error } = await admin
      .schema("account")
      .from("profiles")
      .update({ two_factor_enabled: true })
      .eq("id", session.userId);

    if (error) {
      throw new InternalServerErrorException("Two-factor authentication enabled but profile could not be updated.");
    }

    return {
      success: true,
      twoFactorEnabled: true,
    };
  }

  async disableTwoFactor(session: SessionPayload, code: string) {
    const admin = this.supabaseService.createAdminClient();
    const userResponse = await admin.auth.admin.getUserById(session.userId);
    const metadata = userResponse.data.user?.user_metadata ?? {};
    const secret = metadata.two_factor_secret;

    if (typeof secret !== "string" || secret.length === 0) {
      throw new BadRequestException("Two-factor authentication is not enabled.");
    }

    if (!verifyTotpToken(secret, code)) {
      throw new UnauthorizedException("Invalid authenticator code.");
    }

    const authUpdate = await admin.auth.admin.updateUserById(session.userId, {
      user_metadata: {
        ...metadata,
        two_factor_secret: null,
        two_factor_pending_secret: null,
      },
    });

    if (authUpdate.error) {
      throw new InternalServerErrorException("Unable to disable two-factor authentication.");
    }

    const { error } = await admin
      .schema("account")
      .from("profiles")
      .update({ two_factor_enabled: false })
      .eq("id", session.userId);

    if (error) {
      throw new InternalServerErrorException("Two-factor authentication disabled but profile could not be updated.");
    }

    return {
      success: true,
      twoFactorEnabled: false,
    };
  }

  async sendPasswordReset(identifier: string) {
    const admin = this.supabaseService.createAdminClient();
    const normalizedIdentifier = identifier.includes("@")
      ? normalizeEmail(identifier)
      : normalizePhone(identifier);
    const identifierColumn = identifier.includes("@") ? "email" : "phone";

    const { data: profileRow, error: profileError } = await admin
      .schema("account")
      .from("profiles")
      .select("id, email, role")
      .eq(identifierColumn, normalizedIdentifier)
      .maybeSingle();

    if (profileError) {
      throw new InternalServerErrorException("Unable to prepare your password reset right now.");
    }

    if (!profileRow?.email) {
      throw new NotFoundException("No account found for that email or mobile number.");
    }

    const otp = this.createOtp();
    const otpToken = this.saveOtp({
      email: profileRow.email,
      role: profileRow.role as UserRole,
      userId: profileRow.id,
      purpose: "password_reset",
      otp,
    });
    await this.emailService.sendPasswordResetOtp(profileRow.email, otp);

    return {
      success: true,
      email: profileRow.email,
      otpToken,
      message: "Password reset code sent.",
    };
  }

  async resetPasswordWithOtp(input: {
    otpToken: string;
    otp: string;
    newPassword: string;
  }) {
    if (!PASSWORD_REGEX.test(input.newPassword)) {
      throw new BadRequestException(
        "Password must be at least 8 characters and include a number and special character.",
      );
    }

    const record = this.verifyStoredOtp({
      otpToken: input.otpToken,
      otp: input.otp,
      purpose: "password_reset",
    });
    const admin = this.supabaseService.createAdminClient();
    const updateResult = await admin.auth.admin.updateUserById(record.userId, {
      password: input.newPassword,
    });

    if (updateResult.error) {
      throw new InternalServerErrorException("Unable to update your password right now.");
    }

    return {
      success: true,
      message: "Password updated successfully.",
    };
  }

  async createUser(input: SignupInput) {
    if (!isUserRole(input.role)) {
      throw new BadRequestException("Please select a valid account role.");
    }

    const admin = this.supabaseService.createAdminClient();
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);
    const nameParts = splitFullName(input.fullName);
    const fullName = joinName(nameParts.firstName, nameParts.lastName);

    if (!fullName || !email || phone.length !== 10) {
      throw new BadRequestException("Please enter a valid email and mobile number.");
    }

    const duplicateChecks = await Promise.all([
      admin.schema("account").from("profiles").select("id").eq("email", email).limit(1),
      admin.schema("account").from("profiles").select("id").eq("phone", phone).limit(1),
    ]);
    const duplicateError = duplicateChecks.find((result) => result.error)?.error;
    const duplicateProfiles = duplicateChecks.flatMap((result) => result.data ?? []);

    if (duplicateError) {
      throw new InternalServerErrorException("Unable to validate account uniqueness.");
    }

    if (duplicateProfiles && duplicateProfiles.length > 0) {
      throw new ConflictException("An account with that email or mobile number already exists.");
    }

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: input.role !== "customer",
      user_metadata: {
        first_name: nameParts.firstName,
        last_name: nameParts.lastName,
        full_name: fullName,
        role: input.role,
      },
    });

    if (authError || !authData.user) {
      console.error("[auth] Supabase Auth user creation failed", {
        status: authError?.status,
        code: authError?.code,
        message: authError?.message,
      });
      throw new BadRequestException(authError?.message || "Unable to create auth account.");
    }

    const profile = {
      id: authData.user.id,
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      fullName,
      email,
      phone,
      dob: input.dob,
      role: input.role,
      address: input.address.trim(),
      city: input.city.trim(),
      province: input.province.trim(),
      documents: [],
      createdAt: new Date().toISOString(),
    };

    const profileInsertPayload = {
      id: profile.id,
      full_name: profile.fullName,
      email: profile.email,
      phone: profile.phone,
      dob: profile.dob,
      role: profile.role,
      address: profile.address,
      city: profile.city,
      province: profile.province,
      documents: profile.documents,
      is_verified: input.role !== "customer",
      created_at: profile.createdAt,
    };

    let profileError = (
      await admin
        .schema("account")
        .from("profiles")
        .upsert(profileInsertPayload, { onConflict: "id" })
    ).error;

    // Some existing shared schemas may not yet have the newer profile columns.
    // Retry with a minimal payload so signup can still proceed.
    if (profileError && isMissingProfileColumnError(profileError.message)) {
      profileError = (
        await admin
          .schema("account")
          .from("profiles")
          .upsert(
            {
              id: profile.id,
              full_name: profile.fullName,
              email: profile.email,
              phone: profile.phone,
              dob: profile.dob,
              role: profile.role,
              address: profile.address,
              is_verified: input.role !== "customer",
              created_at: profile.createdAt,
            },
            { onConflict: "id" },
          )
      ).error;
    }

    if (profileError) {
      await admin.auth.admin.deleteUser(profile.id);
      throw new InternalServerErrorException(profileError.message || "Profile could not be saved.");
    }

    if (profile.role !== "customer") {
      try {
        await this.saveApplicationDocuments(profile.id, profile.role, input.documents ?? []);
      } catch (error) {
        await admin.schema("account").from("document_verifications").delete().eq("profile_id", profile.id);
        await admin.schema("account").from("profiles").delete().eq("id", profile.id);
        await admin.auth.admin.deleteUser(profile.id);
        throw error;
      }

      return {
        user: {
          id: profile.id,
          fullName: profile.fullName,
          role: profile.role,
        },
        redirectPath: APPLICATION_REVIEW_PATH,
        requiresVerification: false,
        message: "Application submitted for admin review.",
        session: {
          userId: profile.id,
          role: profile.role,
          fullName: profile.fullName,
        } satisfies SessionPayload,
      };
    }

    const otp = this.createOtp();
    let otpToken: string;
    try {
      otpToken = this.saveOtp({
        email,
        role: profile.role,
        userId: profile.id,
        purpose: "account_verification",
        otp,
      });
      await this.emailService.sendAccountVerificationOtp(email, otp);
    } catch (error) {
      await admin.schema("account").from("profiles").delete().eq("id", profile.id);
      await admin.auth.admin.deleteUser(profile.id);
      throw error;
    }

    return {
      user: {
        id: profile.id,
        fullName: profile.fullName,
        role: profile.role,
      },
      redirectPath: getRedirectPath(profile.role),
      requiresVerification: true,
      otpToken,
      message: "Verification code sent to your email.",
    };
  }

  private async saveApplicationDocuments(
    userId: string,
    role: UserRole,
    documents: SignupDocumentInput[],
  ) {
    const admin = this.supabaseService.createAdminClient();
    const rows = documents.map((document) => {
      if (!APPLICATION_DOCUMENT_ALLOWED_TYPES.has(document.mimeType)) {
        throw new BadRequestException("One of the application documents has an unsupported file type.");
      }

      if (document.size > MAX_APPLICATION_DOCUMENT_SIZE_BYTES) {
        throw new BadRequestException("One of the application documents is too large.");
      }

      return {
        profile_id: userId,
        document_type: document.documentType,
        file_url: `data:${document.mimeType};base64,${document.buffer.toString("base64")}`,
        status: "pending",
      };
    });

    if (rows.length === 0) {
      throw new BadRequestException("Please upload the required application documents.");
    }

    if (role === "driver" || role === "operator") {
      const submittedTypes = new Set(rows.map((row) => row.document_type));
      const missingTypes = REQUIRED_APPLICATION_DOCUMENT_TYPES[role].filter(
        (type) => !submittedTypes.has(type),
      );
      if (missingTypes.length > 0) {
        throw new BadRequestException("Please upload all required application documents.");
      }
    }

    const verificationResult = await admin
      .schema("account")
      .from("document_verifications")
      .insert(rows);

    if (verificationResult.error) {
      throw new InternalServerErrorException("Unable to submit application documents.");
    }

    const documentsResult = await admin
      .schema("account")
      .from("profiles")
      .update({ documents: rows.map((row) => row.file_url) })
      .eq("id", userId);

    if (documentsResult.error) {
      throw new InternalServerErrorException("Unable to attach application documents.");
    }

    if (role === "driver") {
      const driverProfileResult = await admin.schema("driver").from("driver_profiles").upsert(
        {
          id: userId,
          documents_status: "pending",
        },
        { onConflict: "id" },
      );
      if (driverProfileResult.error) {
        throw new InternalServerErrorException("Unable to initialize driver review status.");
      }
    }
  }

  async getApplicationStatus(session: SessionPayload) {
    if (session.role === "customer") {
      return {
        role: session.role,
        status: "approved" as const,
        approved: true,
        requiredDocumentTypes: [],
        redirectPath: getRedirectPath(session.role),
      };
    }

    const requiredDocumentTypes = REQUIRED_APPLICATION_DOCUMENT_TYPES[session.role];
    const admin = this.supabaseService.createAdminClient();
    const { data, error } = await admin
      .schema("account")
      .from("document_verifications")
      .select("document_type, status")
      .eq("profile_id", session.userId)
      .in("document_type", requiredDocumentTypes);

    if (error) {
      throw new InternalServerErrorException("Unable to load application review status.");
    }

    const documentRows = (data ?? []) as ApplicationDocumentRow[];
    const statusesByType = new Map<string, string[]>();
    for (const row of documentRows) {
      const type = String(row.document_type ?? "");
      if (!type) continue;
      statusesByType.set(type, [
        ...(statusesByType.get(type) ?? []),
        String(row.status ?? "pending").toLowerCase(),
      ]);
    }

    const missingDocumentTypes = requiredDocumentTypes.filter(
      (type) => !(statusesByType.get(type)?.length),
    );
    const hasPending = requiredDocumentTypes.some((type) =>
      (statusesByType.get(type) ?? []).includes("pending"),
    );
    const hasApprovedDocuments = requiredDocumentTypes.every((type) =>
      (statusesByType.get(type) ?? []).includes("approved"),
    );
    const hasRejectedRequiredDocument = requiredDocumentTypes.some((type) => {
      const statuses = statusesByType.get(type) ?? [];
      return statuses.includes("rejected") && !statuses.includes("approved") && !statuses.includes("pending");
    });
    const status = hasApprovedDocuments && !hasPending
      ? "approved"
      : hasRejectedRequiredDocument
        ? "rejected"
        : "pending";

    return {
      role: session.role,
      status,
      approved: status === "approved",
      requiredDocumentTypes,
      missingDocumentTypes,
      redirectPath: status === "approved" ? getRedirectPath(session.role) : APPLICATION_REVIEW_PATH,
    };
  }

  private async getAuthenticatedRedirectPath(session: SessionPayload) {
    const application = await this.getApplicationStatus(session);
    return application.redirectPath;
  }

  async verifyAccountEmail(input: {
    otpToken: string;
    otp: string;
  }) {
    const record = this.verifyStoredOtp({
      otpToken: input.otpToken,
      otp: input.otp,
      purpose: "account_verification",
    });
    const admin = this.supabaseService.createAdminClient();
    const authUpdate = await admin.auth.admin.updateUserById(record.userId, {
      email_confirm: true,
    });

    if (authUpdate.error) {
      throw new InternalServerErrorException("Unable to verify your account right now.");
    }

    const { data: profileRow, error: profileError } = await admin
      .schema("account")
      .from("profiles")
      .update({ is_verified: true })
      .eq("id", record.userId)
      .select("id, full_name, role")
      .single();

    if (profileError || !profileRow) {
      throw new InternalServerErrorException("Account verified but profile could not be updated.");
    }

    const role = profileRow.role as UserRole;

    return {
      user: {
        id: profileRow.id,
        fullName: profileRow.full_name,
        role,
      },
      redirectPath: getRedirectPath(role),
      session: {
        userId: profileRow.id,
        role,
        fullName: profileRow.full_name,
      } satisfies SessionPayload,
    };
  }

  async signIn(identifier: string, password: string) {
    const admin = this.supabaseService.createAdminClient();
    const supabase = this.supabaseService.createServerClient();

    const normalizedIdentifier = identifier.includes("@")
      ? normalizeEmail(identifier)
      : normalizePhone(identifier);

    const identifierColumn = identifier.includes("@") ? "email" : "phone";

    const { data: profileRow, error: profileError } = await admin
      .schema("account")
      .from("profiles")
      .select("id, full_name, email, phone, role, two_factor_enabled")
      .eq(identifierColumn, normalizedIdentifier)
      .maybeSingle();

    if (profileError || !profileRow) {
      throw new UnauthorizedException("Invalid credentials.");
    }

    const authUserResult = await admin.auth.admin.getUserById(profileRow.id);
    if (!authUserResult.data.user?.email_confirmed_at) {
      throw new UnauthorizedException("Please verify your email before logging in.");
    }

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: profileRow.email,
      password,
    });

    if (authError || !authData.user) {
      throw new UnauthorizedException("Invalid credentials.");
    }

    const fullName = profileRow.full_name || profileRow.email;
    const session = {
      userId: profileRow.id,
      role: profileRow.role as UserRole,
      fullName,
    } satisfies SessionPayload;

    if (profileRow.two_factor_enabled) {
      const secret = authUserResult.data.user?.user_metadata?.two_factor_secret;

      if (typeof secret === "string" && secret.length > 0) {
        return {
          requiresTwoFactor: true as const,
          challengeToken: createTwoFactorChallengeToken(session),
          user: {
            id: profileRow.id,
            fullName,
            role: profileRow.role as UserRole,
          },
          redirectPath: await this.getAuthenticatedRedirectPath(session),
        };
      }
    }

    return {
      user: {
        id: profileRow.id,
        fullName,
        role: profileRow.role as UserRole,
      },
      redirectPath: await this.getAuthenticatedRedirectPath(session),
      session,
    };
  }

  async verifyTwoFactorLogin(challengeToken: string, code: string) {
    const challengeSession = readTwoFactorChallengeToken(challengeToken);
    if (!challengeSession) {
      throw new UnauthorizedException("Your verification session has expired. Please log in again.");
    }

    const admin = this.supabaseService.createAdminClient();
    const authUserResponse = await admin.auth.admin.getUserById(challengeSession.userId);
    const secret = authUserResponse.data.user?.user_metadata?.two_factor_secret;

    if (typeof secret !== "string" || !verifyTotpToken(secret, code)) {
      throw new UnauthorizedException("Invalid authenticator code.");
    }

    const { data: profileRow } = await admin
      .schema("account")
      .from("profiles")
      .select("full_name")
      .eq("id", challengeSession.userId)
      .maybeSingle();
    const fullName = profileRow?.full_name || challengeSession.fullName;

    const session = {
      userId: challengeSession.userId,
      fullName,
      role: challengeSession.role,
    } satisfies SessionPayload;

    return {
      user: {
        id: challengeSession.userId,
        fullName,
        role: challengeSession.role,
      },
      redirectPath: await this.getAuthenticatedRedirectPath(session),
      session,
    };
  }
}
