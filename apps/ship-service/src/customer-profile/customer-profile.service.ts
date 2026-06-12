import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { SessionPayload } from "../common/session/session.types";
import { CustomerNotificationsService } from "../customer-notifications/customer-notifications.service";
import { SupabaseService } from "../supabase/supabase.service";
import {
  buildOtpAuthUri,
  generateTwoFactorSecret,
  verifyTotpToken,
} from "../auth/two-factor.util";

type CustomerPreferences = {
  emailNotifications: boolean;
  smsUpdates: boolean;
  autoExtend: boolean;
};

type UploadedFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

type UpdateCustomerProfileInput = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  dob?: string;
  preferences?: Partial<CustomerPreferences>;
};

type QuickSaveRecipientInput = {
  name: string;
  phone: string;
};

type SavedRecipientRow = {
  id: string;
  name: string;
  phone: string;
  frequency: number | null;
  last_used_at: string | null;
  created_at: string | null;
};

type DiscountVerificationRow = {
  file_url: string | null;
  status: string | null;
  reviewed_at: string | null;
};

const PROFILE_IMAGE_BUCKET = process.env.SUPABASE_PROFILE_BUCKET || "customer-profile-images";
const DISCOUNT_ID_BUCKET = process.env.SUPABASE_DISCOUNT_BUCKET || "customer-discount-ids";
const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_DISCOUNT_ID_SIZE_BYTES = 8 * 1024 * 1024;
const PASSWORD_REGEX = /^(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;
function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "").slice(-10);
}

function joinName(firstName: string, lastName: string) {
  return [firstName, lastName].map((part) => part.trim()).filter(Boolean).join(" ");
}

function splitFullName(fullName: unknown) {
  const parts = (typeof fullName === "string" ? fullName : "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

function normalizeRecipientPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("09")) {
    return digits.slice(1);
  }

  if (digits.length === 10 && digits.startsWith("9")) {
    return digits;
  }

  return "";
}

function formatRecipientPhone(phone: string) {
  const normalized = normalizeRecipientPhone(phone);
  return normalized ? `0${normalized}` : phone;
}

function buildRecipientInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "N";
}

function mapSavedRecipient(row: SavedRecipientRow) {
  const name = row.name?.trim() || "Unnamed Recipient";

  return {
    id: row.id,
    name,
    phone: formatRecipientPhone(row.phone),
    address: "Saved Contact",
    initial: buildRecipientInitial(name),
    frequency: Math.max(1, row.frequency ?? 1),
    lastUsed: row.last_used_at ?? row.created_at ?? new Date().toISOString(),
    createdAt: row.created_at,
  };
}

function readPreferences(raw: unknown): CustomerPreferences {
  const value = (raw ?? {}) as Partial<CustomerPreferences>;
  return {
    emailNotifications: Boolean(value.emailNotifications),
    smsUpdates: Boolean(value.smsUpdates),
    autoExtend: Boolean(value.autoExtend),
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatCreatedAtLabel(createdAt?: string | null) {
  if (!createdAt) return "Unknown";

  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "Unknown";

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatRelativeTime(value?: string | null) {
  if (!value) return "Just now";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";

  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < hour) {
    const minutes = Math.max(1, Math.floor(diffMs / minute));
    return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  }

  if (diffMs < day) {
    const hours = Math.max(1, Math.floor(diffMs / hour));
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.max(1, Math.floor(diffMs / day));
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function assertAllowedFile(
  file: UploadedFile | undefined,
  options: {
    maxSizeBytes: number;
    allowedTypes: string[];
    emptyMessage: string;
  },
): asserts file is UploadedFile {
  if (!file) {
    throw new BadRequestException(options.emptyMessage);
  }

  if (!options.allowedTypes.includes(file.mimetype)) {
    throw new BadRequestException("Unsupported file type.");
  }

  if (file.size > options.maxSizeBytes) {
    throw new BadRequestException("File is too large.");
  }
}

function getFileExtension(filename: string) {
  const clean = filename.split(".").pop()?.toLowerCase();
  return clean?.replace(/[^a-z0-9]/g, "") || "bin";
}

@Injectable()
export class CustomerProfileService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly customerNotificationsService: CustomerNotificationsService,
  ) {}

  private async ensureStorageBucket(bucketName: string, isPublic = true) {
    const admin = this.supabaseService.createAdminClient();
    const bucketResult = await admin.storage.getBucket(bucketName);

    if (!bucketResult.error && bucketResult.data) {
      return;
    }

    const createResult = await admin.storage.createBucket(bucketName, {
      public: isPublic,
      fileSizeLimit: isPublic ? `${MAX_DISCOUNT_ID_SIZE_BYTES}` : undefined,
    });

    if (createResult.error && !/already exists/i.test(createResult.error.message || "")) {
      throw new InternalServerErrorException(
        `Unable to prepare storage bucket "${bucketName}": ${createResult.error.message || "unknown error"}`,
      );
    }
  }

  async getCustomerProfile(session: SessionPayload) {
    if (session.role !== "customer") {
      throw new ForbiddenException("Only customers can access this profile.");
    }

    const admin = this.supabaseService.createAdminClient();

    const [
      { data: profile, error: profileError },
      authUserResponse,
      submittedDraftsResponse,
      activityLogsResponse,
      discountVerificationResponse,
    ] = await Promise.all([
      admin
        .schema("account")
        .from("profiles")
        .select(`
          id,
          full_name,
          email,
          phone,
          dob,
          address,
          city,
          province,
          profile_picture,
          notification_preferences,
          two_factor_enabled,
          created_at
        `)
        .eq("id", session.userId)
        .single(),
      admin.auth.admin.getUserById(session.userId),
      admin.schema("parcel").from("parcel_drafts")
        .select("id", { count: "exact" })
        .eq("user_id", session.userId)
        .eq("status", "submitted"),
      admin.schema("notifications").from("notifications")
        .select("id, type, title, message, created_at")
        .eq("user_id", session.userId)
        .order("created_at", { ascending: false })
        .limit(5),
      admin.schema("account").from("document_verifications")
        .select("file_url, status, reviewed_at")
        .eq("profile_id", session.userId)
        .eq("document_type", "pwd_or_senior")
        .order("reviewed_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle<DiscountVerificationRow>(),
    ]);

    if (profileError || !profile) {
      throw new NotFoundException("Customer profile not found.");
    }

    const authUser = authUserResponse.data.user;
    const metadata = authUser?.user_metadata ?? {};
    const profilePreferences = isObjectRecord(profile.notification_preferences)
      ? profile.notification_preferences
      : metadata.preferences;
    const preferences = readPreferences(profilePreferences);
    const discountVerification = discountVerificationResponse.data;
    const discountStatus =
      discountVerification?.status === "approved"
        ? "verified"
        : discountVerification?.status === "rejected"
          ? "rejected"
          : discountVerification
            ? "pending"
            : "not_uploaded";
    const activities = (activityLogsResponse.data ?? []).map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      description: item.message,
      createdAt: item.created_at,
      timeLabel: formatRelativeTime(item.created_at),
    }));

    return {
      profile: {
        id: profile.id,
        firstName: splitFullName(profile.full_name).firstName,
        lastName: splitFullName(profile.full_name).lastName,
        fullName: profile.full_name ?? "",
        email: profile.email,
        phone: `0${profile.phone}`,
        address: profile.address,
        dob: profile.dob,
        city: profile.city,
        province: profile.province,
        profilePicture: profile.profile_picture,
        preferences,
        discountIdUploaded: Boolean(discountVerification),
        discountIdType: discountVerification ? "pwd_or_senior" : null,
        discountIdStatus: discountStatus,
        discountIdFileUrl: discountVerification?.file_url ?? null,
        discountIdSubmittedAt: null,
        discountIdVerifiedAt:
          discountStatus === "verified" ? discountVerification?.reviewed_at ?? null : null,
        twoFactorEnabled: Boolean(profile.two_factor_enabled),
        passwordUpdatedAt: null,
      },
      stats: {
        totalBookings: submittedDraftsResponse.count ?? 0,
        activeBookings: submittedDraftsResponse.count ?? 0,
        savedVehicles: 0,
        accountCreated: formatCreatedAtLabel(profile.created_at),
      },
      activity: activities,
    };
  }

  async updateCustomerProfile(session: SessionPayload, input: UpdateCustomerProfileInput) {
    if (session.role !== "customer") {
      throw new ForbiddenException("Only customers can update this profile.");
    }

    const admin = this.supabaseService.createAdminClient();
    const current = await this.getCustomerProfile(session);
    const authUserResponse = await admin.auth.admin.getUserById(session.userId);
    const currentMetadata = authUserResponse.data.user?.user_metadata ?? {};

    const firstName = (input.firstName ?? current.profile.firstName ?? "").trim();
    const lastName = (input.lastName ?? current.profile.lastName ?? "").trim();
    const fullName = joinName(firstName, lastName);
    const email = normalizeEmail(input.email ?? current.profile.email);
    const phone = normalizePhone(input.phone ?? current.profile.phone);
    const address = (input.address ?? current.profile.address ?? "").trim();
    const dob = String(input.dob ?? current.profile.dob ?? "").trim();
    const preferences = {
      ...current.profile.preferences,
      ...(input.preferences ?? {}),
    };
    const emailChanged = email !== normalizeEmail(current.profile.email);

    if (!firstName || !lastName || !email || phone.length !== 10 || !address) {
      throw new BadRequestException("First name, last name, email, phone, and address are required.");
    }

    const duplicateChecks = await Promise.all([
      admin.schema("account").from("profiles").select("id").eq("email", email).neq("id", session.userId).limit(1),
      admin.schema("account").from("profiles").select("id").eq("phone", phone).neq("id", session.userId).limit(1),
    ]);
    const duplicateResult = {
      data: duplicateChecks.flatMap((result) => result.data ?? []),
      error: duplicateChecks.find((result) => result.error)?.error ?? null,
    };

    if (duplicateResult.error) {
      throw new InternalServerErrorException("Unable to validate profile details.");
    }

    if ((duplicateResult.data ?? []).length > 0) {
      throw new ConflictException("Another account already uses that email or phone number.");
    }

    const authUpdate = await admin.auth.admin.updateUserById(session.userId, {
      ...(emailChanged ? { email, email_confirm: true } : {}),
      user_metadata: {
        ...currentMetadata,
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        preferences,
      },
    });

    if (authUpdate.error) {
      throw new InternalServerErrorException("Unable to save profile authentication details.");
    }

    const { error: profileError } = await admin
      .schema("account")
      .from("profiles")
      .update({
        full_name: fullName,
        email,
        phone,
        address,
        dob: dob || null,
        notification_preferences: preferences,
      })
      .eq("id", session.userId);

    if (profileError) {
      throw new InternalServerErrorException("Unable to update customer profile.");
    }

    const activityTitle = "Profile details updated";
    const activityDescription = "Your customer profile information was refreshed.";

    await this.customerNotificationsService.createNotification(
      session.userId,
      "system",
      activityTitle,
      activityDescription,
    );

    return this.getCustomerProfile({
      ...session,
      fullName,
    });
  }

  async getSavedRecipients(session: SessionPayload) {
    if (session.role !== "customer") {
      throw new ForbiddenException("Only customers can access saved recipients.");
    }

    return { recipients: [] };
  }

  async quickSaveRecipient(session: SessionPayload, input: QuickSaveRecipientInput) {
    if (session.role !== "customer") {
      throw new ForbiddenException("Only customers can save recipients.");
    }

    const name = input.name.trim();
    const phone = normalizeRecipientPhone(input.phone);

    if (!name) {
      throw new BadRequestException("Recipient name is required.");
    }

    if (!phone) {
      throw new BadRequestException("Please enter a valid Philippine mobile number.");
    }

    const now = new Date().toISOString();

    return {
      recipient: mapSavedRecipient({
        id: randomUUID(),
        name,
        phone,
        frequency: 1,
        last_used_at: now,
        created_at: now,
      }),
      alreadySaved: false,
    };
  }

  async uploadProfilePicture(session: SessionPayload, file: UploadedFile | undefined) {
    if (session.role !== "customer") {
      throw new ForbiddenException("Only customers can update this profile.");
    }

    assertAllowedFile(file, {
      maxSizeBytes: MAX_AVATAR_SIZE_BYTES,
      allowedTypes: ["image/jpeg", "image/png", "image/webp"],
      emptyMessage: "Please choose an image to upload.",
    });

    await this.ensureStorageBucket(PROFILE_IMAGE_BUCKET, true);

    const admin = this.supabaseService.createAdminClient();
    const extension = getFileExtension(file.originalname);
    const objectPath = `${session.userId}/avatar-${randomUUID()}.${extension}`;
    const uploadResult = await admin.storage.from(PROFILE_IMAGE_BUCKET).upload(objectPath, file.buffer, {
      contentType: file.mimetype,
      upsert: true,
    });

    if (uploadResult.error) {
      throw new InternalServerErrorException(
        `Unable to upload your profile image: ${uploadResult.error.message || "storage upload failed"}.`,
      );
    }

    const { data: publicUrlData } = admin.storage
      .from(PROFILE_IMAGE_BUCKET)
      .getPublicUrl(objectPath);
    const profilePicture = publicUrlData.publicUrl;

    const { error } = await admin
      .schema("account")
      .from("profiles")
      .update({ profile_picture: profilePicture })
      .eq("id", session.userId);

    if (error) {
      throw new InternalServerErrorException(
        `Profile picture uploaded but could not be saved: ${error.message || "profile update failed"}.`,
      );
    }

    await this.logCustomerEvent(
      session.userId,
      "profile",
      "Profile photo updated",
      "Your new profile photo is now visible in the app.",
      "system",
    );

    return {
      profilePicture,
    };
  }

  async uploadDiscountId(session: SessionPayload, file: UploadedFile | undefined) {
    if (session.role !== "customer") {
      throw new ForbiddenException("Only customers can update this profile.");
    }

    assertAllowedFile(file, {
      maxSizeBytes: MAX_DISCOUNT_ID_SIZE_BYTES,
      allowedTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      emptyMessage: "Please choose a discount ID to upload.",
    });

    await this.ensureStorageBucket(DISCOUNT_ID_BUCKET, true);

    const admin = this.supabaseService.createAdminClient();
    const extension = getFileExtension(file.originalname);
    const objectPath = `${session.userId}/discount-id-${randomUUID()}.${extension}`;
    const uploadResult = await admin.storage.from(DISCOUNT_ID_BUCKET).upload(objectPath, file.buffer, {
      contentType: file.mimetype,
      upsert: true,
    });

    if (uploadResult.error) {
      throw new InternalServerErrorException(
        `Unable to upload your discount ID: ${uploadResult.error.message || "storage upload failed"}.`,
      );
    }

    const { data: publicUrlData } = admin.storage
      .from(DISCOUNT_ID_BUCKET)
      .getPublicUrl(objectPath);
    const discountIdFileUrl = publicUrlData.publicUrl;
    const submittedAt = new Date().toISOString();
    const { error } = await admin
      .schema("account")
      .from("profiles")
      .update({
        documents: [discountIdFileUrl],
      })
      .eq("id", session.userId);

    if (error) {
      throw new InternalServerErrorException(
        `Discount ID uploaded but could not be saved: ${error.message || "profile update failed"}.`,
      );
    }

    const verificationResult = await admin.schema("account").from("document_verifications").insert({
      profile_id: session.userId,
      document_type: "pwd_or_senior",
      file_url: discountIdFileUrl,
      status: "pending",
    });

    if (verificationResult.error) {
      throw new InternalServerErrorException(
        `Discount ID uploaded but could not be queued for review: ${verificationResult.error.message || "verification request failed"}.`,
      );
    }

    await this.logCustomerEvent(
      session.userId,
      "verification",
      "Discount ID submitted",
      "Your PWD or Senior Citizen ID was uploaded and is now pending review.",
      "system",
    );

    return {
      discountIdUploaded: true,
      discountIdStatus: "pending" as const,
      discountIdType: "pwd_or_senior",
      discountIdFileUrl,
      discountIdSubmittedAt: submittedAt,
    };
  }

  async changePassword(
    session: SessionPayload,
    currentPassword: string,
    newPassword: string,
  ) {
    if (session.role !== "customer") {
      throw new ForbiddenException("Only customers can update this profile.");
    }

    if (!currentPassword || !newPassword) {
      throw new BadRequestException("Current and new passwords are required.");
    }

    if (!PASSWORD_REGEX.test(newPassword)) {
      throw new BadRequestException(
        "New password must be at least 8 characters and include a number and special character.",
      );
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException("New password must be different from your current password.");
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
      throw new NotFoundException("Customer profile not found.");
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

    await this.logCustomerEvent(
      session.userId,
      "security",
      "Password changed",
      "Your account password was successfully updated.",
      "system",
    );

    return this.getCustomerProfile(session);
  }

  async createTwoFactorSetup(session: SessionPayload) {
    if (session.role !== "customer") {
      throw new ForbiddenException("Only customers can update this profile.");
    }

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
    const currentMetadata = authUserResponse.data.user?.user_metadata ?? {};

    if (profileResponse.error || !profileResponse.data) {
      throw new NotFoundException("Customer profile not found.");
    }

    if (profileResponse.data.two_factor_enabled) {
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
      otpauthUri: buildOtpAuthUri(secret, profileResponse.data.email),
      twoFactorEnabled: false,
    };
  }

  async enableTwoFactor(session: SessionPayload, code: string) {
    if (session.role !== "customer") {
      throw new ForbiddenException("Only customers can update this profile.");
    }

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

    await this.logCustomerEvent(
      session.userId,
      "security",
      "Authenticator app enabled",
      "Two-factor authentication is now protecting your account through authenticator codes.",
      "system",
    );

    return this.getCustomerProfile(session);
  }

  async disableTwoFactor(session: SessionPayload, code: string) {
    if (session.role !== "customer") {
      throw new ForbiddenException("Only customers can update this profile.");
    }

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

    await this.logCustomerEvent(
      session.userId,
      "security",
      "Authenticator app disabled",
      "Two-factor authentication was turned off for your account.",
      "system",
    );

    return this.getCustomerProfile(session);
  }

  private async logCustomerEvent(
    userId: string,
    activityType: string,
    title: string,
    description: string,
    notificationType: "delivery" | "system" | "promo" = "system",
  ) {
    await this.customerNotificationsService.createNotification(
      userId,
      notificationType,
      title,
      description,
    );
  }
}
