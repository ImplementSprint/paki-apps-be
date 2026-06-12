import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type { SessionPayload } from "../common/session/session.types";
import { SupabaseService } from "../supabase/supabase.service";
import { ProfileRepository } from "./profile.repository";
import type {
  BaseProfile,
  DriverDocumentRecord,
  DriverDocumentType,
  DriverProfileDetails,
  OperatorDocumentRecord,
  OperatorDocumentType,
  OperatorProfileDetails,
  UpdateProfileInput,
} from "./profile.types";

type UploadedFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

const DRIVER_DOCUMENT_TYPES = new Set<DriverDocumentType>([
  "license",
  "id",
  "registration",
]);
const OPERATOR_DOCUMENT_TYPE_MAP: Record<string, OperatorDocumentType> = {
  "government-id": "governmentId",
  governmentId: "governmentId",
  "business-permit": "businessPermit",
  businessPermit: "businessPermit",
};
const DRIVER_DOCUMENT_ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const MAX_DRIVER_DOCUMENT_SIZE_BYTES = 8 * 1024 * 1024;

function asTrimmedString(value: unknown) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function asOptionalArrayOfStrings(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => String(item)).filter(Boolean);
}

function asOptionalStringPatch(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.trim();
}

function asOptionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDriverDocumentType(value: string): value is DriverDocumentType {
  return DRIVER_DOCUMENT_TYPES.has(value as DriverDocumentType);
}

function normalizeOperatorDocumentType(value: string): OperatorDocumentType | null {
  return OPERATOR_DOCUMENT_TYPE_MAP[value] ?? null;
}

function getDefaultDriverDetails(): DriverProfileDetails {
  return {
    vehicleType: null,
    plateNumber: null,
    licenseNumber: null,
    bankAccount: null,
    emergencyContact: null,
    documentsUploaded: {
      license: false,
      id: false,
      registration: false,
    },
    documents: {},
  };
}

function getDefaultOperatorDetails(): OperatorProfileDetails {
  return {
    documentsUploaded: {
      governmentId: false,
      businessPermit: false,
    },
    documents: {},
  };
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "").slice(-11);
}

function asNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

const PH_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000;

function getPhilippineDateParts(date = new Date()) {
  const phDate = new Date(date.getTime() + PH_TIMEZONE_OFFSET_MS);

  return {
    year: phDate.getUTCFullYear(),
    month: phDate.getUTCMonth(),
    date: phDate.getUTCDate(),
    day: phDate.getUTCDay(),
  };
}

function philippineLocalMidnightToUtcIso(year: number, month: number, date: number) {
  return new Date(Date.UTC(year, month, date) - PH_TIMEZONE_OFFSET_MS).toISOString();
}

function startOfPhilippineDayIso(date = new Date()) {
  const parts = getPhilippineDateParts(date);
  return philippineLocalMidnightToUtcIso(parts.year, parts.month, parts.date);
}

function startOfPhilippineWeekIso(date = new Date()) {
  const parts = getPhilippineDateParts(date);
  const daysSinceMonday = (parts.day + 6) % 7;
  return philippineLocalMidnightToUtcIso(parts.year, parts.month, parts.date - daysSinceMonday);
}

function startOfPhilippineMonthIso(date = new Date()) {
  const parts = getPhilippineDateParts(date);
  return philippineLocalMidnightToUtcIso(parts.year, parts.month, 1);
}

function sumAmounts(rows: unknown[] | null | undefined) {
  return (rows ?? []).reduce<number>((sum, row) => {
    const amount = isObjectRecord(row) ? row.amount : 0;
    return sum + asNumber(amount);
  }, 0);
}

@Injectable()
export class ProfileService {
  constructor(
    private readonly profileRepository: ProfileRepository,
    private readonly supabaseService: SupabaseService,
  ) {}

  async getMyProfile(session: SessionPayload) {
    const { data, error } = await this.profileRepository.findByUserId(session.userId);
    if (error || !data) {
      throw new NotFoundException("Profile not found.");
    }

    return {
      profile: await this.withDriverMetrics(this.profileRepository.mapProfileRow(data)),
    };
  }

  private async loadDriverMetrics(profile: BaseProfile) {
    const admin = this.supabaseService.createAdminClient();

    const totalJobsResult = await admin.schema("driver").from("driver_jobs")
      .select("id", { count: "exact", head: true })
      .eq("driver_id", profile.id);

    if (totalJobsResult.error) {
      throw new InternalServerErrorException("Unable to load driver stats.");
    }

    const completedJobsResult = await admin.schema("driver").from("driver_jobs")
      .select("parcel_draft_id", { count: "exact" })
      .eq("driver_id", profile.id)
      .eq("status", "completed");

    if (completedJobsResult.error) {
      throw new InternalServerErrorException("Unable to load driver stats.");
    }

    const todayStart = startOfPhilippineDayIso();
    const weekStart = startOfPhilippineWeekIso();
    const monthStart = startOfPhilippineMonthIso();
    const [todayEarningsResult, weekEarningsResult, monthEarningsResult] = await Promise.all([
      admin.schema("driver").from("driver_earnings")
        .select("amount")
        .eq("driver_id", profile.id)
        .gte("earned_at", todayStart),
      admin.schema("driver").from("driver_earnings")
        .select("amount")
        .eq("driver_id", profile.id)
        .gte("earned_at", weekStart),
      admin.schema("driver").from("driver_earnings")
        .select("amount")
        .eq("driver_id", profile.id)
        .gte("earned_at", monthStart),
    ]);

    if (todayEarningsResult.error || weekEarningsResult.error || monthEarningsResult.error) {
      throw new InternalServerErrorException("Unable to load driver earnings.");
    }

    const draftIds = (completedJobsResult.data ?? [])
      .map((row) => (row as { parcel_draft_id?: string | null }).parcel_draft_id)
      .filter((id): id is string => Boolean(id));

    const reviewsResult = draftIds.length > 0
      ? await admin.schema("parcel").from("parcel_reviews")
          .select("rating")
          .in("parcel_draft_id", draftIds)
      : { data: [], error: null };

    if (reviewsResult.error) {
      throw new InternalServerErrorException("Unable to load driver rating.");
    }

    const ratings = (reviewsResult.data ?? [])
      .map((row) => asNumber((row as { rating?: number | string | null }).rating))
      .filter((rating) => rating > 0);
    const average =
      ratings.length > 0
        ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
        : null;

    return {
      rating: {
        average,
        count: ratings.length,
      },
      stats: {
        totalDeliveries: totalJobsResult.count ?? 0,
        completedJobs: completedJobsResult.count ?? 0,
        ratingAverage: average,
        ratingCount: ratings.length,
        memberSince: profile.createdAt,
      },
      earnings: {
        today: sumAmounts(todayEarningsResult.data),
        thisWeek: sumAmounts(weekEarningsResult.data),
        thisMonth: sumAmounts(monthEarningsResult.data),
      },
    };
  }

  private async withDriverMetrics(profile: BaseProfile) {
    if (profile.role !== "driver") {
      return profile;
    }

    const metrics = await this.loadDriverMetrics(profile);

    return {
      ...profile,
      driverRating: metrics.rating,
      driverStats: metrics.stats,
      driverEarnings: metrics.earnings,
    };
  }

  async updateMyProfile(session: SessionPayload, body: Record<string, unknown>) {
    const current = await this.profileRepository.findByUserId(session.userId);
    if (current.error || !current.data) {
      throw new NotFoundException("Profile not found.");
    }

    const patch: UpdateProfileInput = {};
    const firstName = asTrimmedString(body.firstName);
    const lastName = asTrimmedString(body.lastName);
    const email = asTrimmedString(body.email);
    const phone = asTrimmedString(body.phone);
    const dob = asTrimmedString(body.dob);
    const address = asTrimmedString(body.address);
    const city = asTrimmedString(body.city);
    const province = asTrimmedString(body.province);
    const currentProfile = this.profileRepository.mapProfileRow(current.data);

    if ("firstName" in body) {
      if (!firstName) throw new BadRequestException("First name cannot be empty.");
      patch.firstName = firstName;
    }
    if ("lastName" in body) {
      if (!lastName) throw new BadRequestException("Last name cannot be empty.");
      patch.lastName = lastName;
    }
    if ("email" in body) {
      if (!email) throw new BadRequestException("Email cannot be empty.");
      patch.email = normalizeEmail(email);
    }
    if ("phone" in body) {
      if (!phone) throw new BadRequestException("Phone cannot be empty.");
      const normalizedPhone = normalizePhone(phone);
      if (normalizedPhone.length !== 11) {
        throw new BadRequestException("Phone must contain 11 digits.");
      }
      patch.phone = normalizedPhone;
    }
    if ("dob" in body) {
      if (!dob) throw new BadRequestException("Date of birth cannot be empty.");
      patch.dob = dob;
    }
    if ("address" in body) {
      if (!address) throw new BadRequestException("Address cannot be empty.");
      patch.address = address;
    }
    if ("city" in body) {
      if (!city) throw new BadRequestException("City cannot be empty.");
      patch.city = city;
    }
    if ("province" in body) {
      if (!province) throw new BadRequestException("Province cannot be empty.");
      patch.province = province;
    }
    if ("profilePhotoUrl" in body) {
      patch.profilePhotoUrl = body.profilePhotoUrl ? String(body.profilePhotoUrl) : null;
    }
    if (session.role === "driver" && isObjectRecord(body.driverDetails)) {
      const details = body.driverDetails;
      const currentDetails = currentProfile.driverDetails;
      const nextDetails = {
        vehicleType:
          asOptionalStringPatch(details.vehicleType) ?? currentDetails?.vehicleType ?? null,
        plateNumber:
          asOptionalStringPatch(details.plateNumber) ?? currentDetails?.plateNumber ?? null,
        licenseNumber:
          asOptionalStringPatch(details.licenseNumber) ?? currentDetails?.licenseNumber ?? null,
        bankAccount:
          asOptionalStringPatch(details.bankAccount) ?? currentDetails?.bankAccount ?? null,
        emergencyContact:
          asOptionalStringPatch(details.emergencyContact) ??
          currentDetails?.emergencyContact ??
          null,
        documentsUploaded: {
          license:
            asOptionalBoolean(
              isObjectRecord(details.documentsUploaded)
                ? details.documentsUploaded.license
                : undefined,
            ) ?? Boolean(currentDetails?.documentsUploaded.license),
          id:
            asOptionalBoolean(
              isObjectRecord(details.documentsUploaded)
                ? details.documentsUploaded.id
                : undefined,
            ) ?? Boolean(currentDetails?.documentsUploaded.id),
          registration:
            asOptionalBoolean(
              isObjectRecord(details.documentsUploaded)
                ? details.documentsUploaded.registration
                : undefined,
            ) ?? Boolean(currentDetails?.documentsUploaded.registration),
        },
        documents: currentDetails?.documents ?? {},
      };

      if (!nextDetails.vehicleType || !nextDetails.plateNumber || !nextDetails.licenseNumber) {
        throw new BadRequestException(
          "Vehicle type, plate number, and license number are required.",
        );
      }

      const driverProfileResult = await this.supabaseService.createAdminClient().schema("driver").from("driver_profiles")
        .upsert(
          {
            id: session.userId,
            vehicle_type: nextDetails.vehicleType,
            license_number: nextDetails.licenseNumber,
            delivery_mode: "direct",
            documents_status: Object.values(nextDetails.documentsUploaded).every(Boolean)
              ? "complete"
              : "pending",
          },
          { onConflict: "id" },
        );

      if (driverProfileResult.error) {
        throw new InternalServerErrorException("Unable to update driver profile details.");
      }
    }

    const documents = asOptionalArrayOfStrings(body.documents);
    if (documents) {
      patch.documents = documents;
    }

    if (patch.email || patch.phone) {
      const duplicate = await this.profileRepository.findPotentialDuplicate(
        session.userId,
        patch.email,
        patch.phone,
      );

      if (duplicate.error) {
        throw new InternalServerErrorException("Unable to validate profile uniqueness.");
      }

      if (duplicate.data && duplicate.data.length > 0) {
        throw new ConflictException("Another profile already uses that email or phone.");
      }
    }

    const admin = this.supabaseService.createAdminClient();
    const nextEmail = patch.email;
    const emailChanged = Boolean(nextEmail && nextEmail !== currentProfile.email);

    if (emailChanged) {
      const authUpdate = await admin.auth.admin.updateUserById(session.userId, {
        email: nextEmail,
        email_confirm: true,
      });

      if (authUpdate.error) {
        throw new InternalServerErrorException("Unable to update auth email.");
      }
    }

    const { data, error } = await this.profileRepository.updateByUserId(session.userId, patch);
    if (error || !data) {
      if (emailChanged) {
        await admin.auth.admin.updateUserById(session.userId, {
          email: currentProfile.email,
          email_confirm: true,
        });
      }
      throw new InternalServerErrorException("Unable to update profile.");
    }

    return {
      profile: await this.withDriverMetrics(this.profileRepository.mapProfileRow(data)),
      message: "Profile updated successfully.",
    };
  }

  async uploadDriverDocument(
    session: SessionPayload,
    documentType: string,
    file?: UploadedFile,
  ) {
    if (session.role !== "driver") {
      throw new BadRequestException("Only drivers can upload driver documents.");
    }

    if (!isDriverDocumentType(documentType)) {
      throw new BadRequestException("Document type is invalid.");
    }

    if (!file) {
      throw new BadRequestException("Please choose a document to upload.");
    }

    if (!DRIVER_DOCUMENT_ALLOWED_TYPES.has(file.mimetype)) {
      throw new BadRequestException("Unsupported document file type.");
    }

    if (file.size > MAX_DRIVER_DOCUMENT_SIZE_BYTES) {
      throw new BadRequestException("Document file is too large.");
    }

    const current = await this.profileRepository.findByUserId(session.userId);
    if (current.error || !current.data) {
      throw new NotFoundException("Profile not found.");
    }

    const currentProfile = this.profileRepository.mapProfileRow(current.data);
    const documentRecord: DriverDocumentRecord = {
      type: documentType,
      fileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      dataUrl: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
      uploadedAt: new Date().toISOString(),
    };
    const admin = this.supabaseService.createAdminClient();
    const verificationResult = await admin.schema("account").from("document_verifications").insert({
      profile_id: session.userId,
      document_type: documentType === "license" ? "driver_license" : documentType,
      file_url: documentRecord.dataUrl,
      status: "pending",
    });

    if (verificationResult.error) {
      throw new InternalServerErrorException("Unable to save driver document.");
    }

    const documents = [...new Set([...currentProfile.documents, documentRecord.dataUrl])];
    const { data, error } = await this.profileRepository.updateByUserId(session.userId, {
      documents,
    });

    if (error || !data) {
      throw new InternalServerErrorException("Unable to save driver document.");
    }

    await admin.schema("driver").from("driver_profiles").upsert(
      {
        id: session.userId,
        documents_status: "pending",
      },
      { onConflict: "id" },
    );

    return {
      profile: await this.withDriverMetrics(this.profileRepository.mapProfileRow(data)),
      document: {
        type: documentRecord.type,
        fileName: documentRecord.fileName,
        mimeType: documentRecord.mimeType,
        size: documentRecord.size,
        uploadedAt: documentRecord.uploadedAt,
      },
      message: "Driver document uploaded successfully.",
    };
  }

  async uploadOperatorDocument(
    session: SessionPayload,
    documentTypeInput: string,
    file?: UploadedFile,
  ) {
    if (session.role !== "operator") {
      throw new BadRequestException("Only operators can upload operator documents.");
    }

    const documentType = normalizeOperatorDocumentType(documentTypeInput);
    if (!documentType) {
      throw new BadRequestException("Document type is invalid.");
    }

    if (!file) {
      throw new BadRequestException("Please choose a document to upload.");
    }

    if (!DRIVER_DOCUMENT_ALLOWED_TYPES.has(file.mimetype)) {
      throw new BadRequestException("Unsupported document file type.");
    }

    if (file.size > MAX_DRIVER_DOCUMENT_SIZE_BYTES) {
      throw new BadRequestException("Document file is too large.");
    }

    const current = await this.profileRepository.findByUserId(session.userId);
    if (current.error || !current.data) {
      throw new NotFoundException("Profile not found.");
    }

    const currentProfile = this.profileRepository.mapProfileRow(current.data);
    const documentRecord: OperatorDocumentRecord = {
      type: documentType,
      fileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      dataUrl: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
      uploadedAt: new Date().toISOString(),
    };
    const admin = this.supabaseService.createAdminClient();
    const verificationResult = await admin.schema("account").from("document_verifications").insert({
      profile_id: session.userId,
      document_type: documentType === "governmentId" ? "land_use_or_cr" : "business_permit",
      file_url: documentRecord.dataUrl,
      status: "pending",
    });

    if (verificationResult.error) {
      throw new InternalServerErrorException("Unable to save operator document.");
    }

    const documents = [...new Set([...currentProfile.documents, documentRecord.dataUrl])];
    const { data, error } = await this.profileRepository.updateByUserId(session.userId, {
      documents,
    });

    if (error || !data) {
      throw new InternalServerErrorException("Unable to save operator document.");
    }

    return {
      profile: this.profileRepository.mapProfileRow(data),
      document: {
        type: documentRecord.type,
        fileName: documentRecord.fileName,
        mimeType: documentRecord.mimeType,
        size: documentRecord.size,
        uploadedAt: documentRecord.uploadedAt,
      },
      message: "Operator document uploaded successfully.",
    };
  }
}
