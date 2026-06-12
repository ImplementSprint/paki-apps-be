import { Injectable } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";
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

type ProfileRow = Record<string, any>;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNullableString(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length ? text : null;
}

function joinName(firstName: unknown, lastName: unknown) {
  return [firstName, lastName]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ");
}

function splitFullName(fullName: unknown) {
  const parts = (typeof fullName === "string" ? fullName : "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

function mapDriverDocument(type: DriverDocumentType, value: unknown): DriverDocumentRecord | undefined {
  if (!isObjectRecord(value)) return undefined;

  const fileName = asNullableString(value.fileName);
  const mimeType = asNullableString(value.mimeType);
  const dataUrl = asNullableString(value.dataUrl);
  const uploadedAt = asNullableString(value.uploadedAt);
  const size = Number(value.size);

  if (!fileName || !mimeType || !dataUrl || !uploadedAt || !Number.isFinite(size)) {
    return undefined;
  }

  return {
    type,
    fileName,
    mimeType,
    size,
    dataUrl,
    uploadedAt,
  };
}

function mapDriverDetails(value: unknown): DriverProfileDetails {
  const details = isObjectRecord(value) ? value : {};
  const documentsUploaded = isObjectRecord(details.documentsUploaded)
    ? details.documentsUploaded
    : {};
  const documents = isObjectRecord(details.documents) ? details.documents : {};

  return {
    vehicleType: asNullableString(details.vehicleType),
    plateNumber: asNullableString(details.plateNumber),
    licenseNumber: asNullableString(details.licenseNumber),
    bankAccount: asNullableString(details.bankAccount),
    emergencyContact: asNullableString(details.emergencyContact),
    documentsUploaded: {
      license: Boolean(documentsUploaded.license),
      id: Boolean(documentsUploaded.id),
      registration: Boolean(documentsUploaded.registration),
    },
    documents: {
      license: mapDriverDocument("license", documents.license),
      id: mapDriverDocument("id", documents.id),
      registration: mapDriverDocument("registration", documents.registration),
    },
  };
}

function mapOperatorDocument(
  type: OperatorDocumentType,
  value: unknown,
): OperatorDocumentRecord | undefined {
  if (!isObjectRecord(value)) return undefined;

  const fileName = asNullableString(value.fileName);
  const mimeType = asNullableString(value.mimeType);
  const dataUrl = asNullableString(value.dataUrl);
  const uploadedAt = asNullableString(value.uploadedAt);
  const size = Number(value.size);

  if (!fileName || !mimeType || !dataUrl || !uploadedAt || !Number.isFinite(size)) {
    return undefined;
  }

  return {
    type,
    fileName,
    mimeType,
    size,
    dataUrl,
    uploadedAt,
  };
}

function mapOperatorDetails(value: unknown): OperatorProfileDetails {
  const details = isObjectRecord(value) ? value : {};
  const documentsUploaded = isObjectRecord(details.documentsUploaded)
    ? details.documentsUploaded
    : {};
  const documents = isObjectRecord(details.documents) ? details.documents : {};

  return {
    documentsUploaded: {
      governmentId: Boolean(documentsUploaded.governmentId),
      businessPermit: Boolean(documentsUploaded.businessPermit),
    },
    documents: {
      governmentId: mapOperatorDocument("governmentId", documents.governmentId),
      businessPermit: mapOperatorDocument("businessPermit", documents.businessPermit),
    },
  };
}

@Injectable()
export class ProfileRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  findByUserId(userId: string) {
    const supabase = this.supabaseService.createAdminClient();
    return supabase.schema("account").from("profiles").select("*").eq("id", userId).maybeSingle();
  }

  async findPotentialDuplicate(userId: string, email?: string, phone?: string) {
    const supabase = this.supabaseService.createAdminClient();
    const checks = await Promise.all([
      email
        ? supabase.schema("account").from("profiles").select("id").eq("email", email).neq("id", userId).limit(1)
        : Promise.resolve({ data: [], error: null }),
      phone
        ? supabase.schema("account").from("profiles").select("id").eq("phone", phone).neq("id", userId).limit(1)
        : Promise.resolve({ data: [], error: null }),
    ]);

    return {
      data: checks.flatMap((result) => result.data ?? []),
      error: checks.find((result) => result.error)?.error ?? null,
    };
  }

  updateByUserId(userId: string, input: UpdateProfileInput) {
    const supabase = this.supabaseService.createAdminClient();
    const updatePayload: Record<string, unknown> = {};

    if (input.firstName !== undefined || input.lastName !== undefined) {
      updatePayload.full_name = joinName(input.firstName, input.lastName);
    }
    if (input.email !== undefined) updatePayload.email = input.email;
    if (input.phone !== undefined) updatePayload.phone = input.phone;
    if (input.dob !== undefined) updatePayload.dob = input.dob;
    if (input.address !== undefined) updatePayload.address = input.address;
    if (input.city !== undefined) updatePayload.city = input.city;
    if (input.province !== undefined) updatePayload.province = input.province;
    if (input.documents !== undefined) updatePayload.documents = input.documents;
    if (input.profilePhotoUrl !== undefined) updatePayload.profile_picture = input.profilePhotoUrl;

    return supabase
      .schema("account")
      .from("profiles")
      .update(updatePayload)
      .eq("id", userId)
      .select("*")
      .single();
  }

  mapProfileRow(row: ProfileRow): BaseProfile {
    return {
      id: row.id,
      firstName: splitFullName(row.full_name).firstName,
      lastName: splitFullName(row.full_name).lastName,
      fullName: row.full_name ?? "",
      email: row.email ?? "",
      phone: row.phone ?? null,
      dob: row.dob ?? null,
      role: row.role,
      address: row.address ?? null,
      city: row.city ?? null,
      province: row.province ?? null,
      documents: Array.isArray(row.documents) ? row.documents.map((item: unknown) => String(item)) : [],
      profilePhotoUrl: row.profile_picture ?? null,
      driverDetails: row.role === "driver" ? mapDriverDetails(undefined) : undefined,
      operatorDetails: row.role === "operator" ? mapOperatorDetails(undefined) : undefined,
      createdAt: row.created_at ?? null,
    };
  }
}
