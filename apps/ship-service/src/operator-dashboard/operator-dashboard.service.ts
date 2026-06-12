import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { SessionPayload } from "../common/session/session.types";
import { CustomerNotificationsService } from "../customer-notifications/customer-notifications.service";
import { ParcelDraftsRepository } from "../parcel-drafts/parcel-drafts.repository";
import { SupabaseService } from "../supabase/supabase.service";

type DropOffPointProfileRow = {
  id: string;
  owner_user_id: string;
  code: string | null;
  name: string | null;
  address: string | null;
  storage_capacity: number | string | null;
  latitude?: number | string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  is_active: boolean | null;
  geofence_on: boolean | null;
};

type ParcelHubRecordRow = {
  parcel_draft_id?: string | null;
};

type MonetaryRow = {
  amount: number | string | null;
};

type ParcelDraftLookupRow = {
  id: string;
  tracking_number: string | null;
  sender_name: string | null;
  receiver_name: string | null;
  status: string;
  drop_off_point_id?: string | null;
};

type ParcelHubRecordLookupRow = {
  id: string;
  hub_id: string;
  parcel_draft_id?: string | null;
  status: string;
  storage_location?: string | null;
  received_at: string | null;
  picked_up_at?: string | null;
  dispatched_at?: string | null;
  parcel_drafts?:
    | {
        id: string;
        user_id?: string | null;
        tracking_number?: string | null;
        sender_name?: string | null;
        receiver_name?: string | null;
      }
    | Array<{
        id: string;
        user_id?: string | null;
        tracking_number?: string | null;
        sender_name?: string | null;
        receiver_name?: string | null;
      }>
    | null;
};

type HubParcelRow = {
  id: string;
  hub_id: string;
  parcel_draft_id?: string | null;
  status: string;
  storage_location?: string | null;
  received_at: string | null;
  picked_up_at?: string | null;
  dispatched_at?: string | null;
  parcel_drafts?:
    | {
        id: string;
        user_id?: string | null;
        tracking_number?: string | null;
        sender_name?: string | null;
        receiver_name?: string | null;
      }
    | Array<{
        id: string;
        user_id?: string | null;
        tracking_number?: string | null;
        sender_name?: string | null;
        receiver_name?: string | null;
      }>
    | null;
};

type AssignedRelayDraftRow = {
  id: string;
  tracking_number: string | null;
  status: string | null;
  drop_off_point_id: string | null;
};

type ParcelDraftHubFallbackRow = {
  id: string;
  user_id?: string | null;
  tracking_number?: string | null;
  sender_name?: string | null;
  receiver_name?: string | null;
  status: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const PH_TIMEZONE_OFFSET_HOURS = 8;

function startOfPhilippineDay(now = new Date()) {
  const shifted = new Date(now.getTime() + PH_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - PH_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000);
}

function startOfPhilippineWeek(now = new Date()) {
  const dayStart = startOfPhilippineDay(now);
  const shifted = new Date(dayStart.getTime() + PH_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000);
  const dayOfWeek = shifted.getUTCDay();
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  shifted.setUTCDate(shifted.getUTCDate() - diffToMonday);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - PH_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000);
}

function startOfPhilippineMonth(now = new Date()) {
  const shifted = new Date(now.getTime() + PH_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000);
  shifted.setUTCDate(1);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - PH_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000);
}

function sumAmounts(rows: MonetaryRow[] | null | undefined) {
  return (rows ?? []).reduce((total, row) => {
    const amount = Number(row.amount ?? 0);
    return total + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function createEmptyDashboard(reason: string) {
  return {
    kpis: {
      incomingToday: 0,
      currentlyStored: 0,
      pickedUpToday: 0,
      customersServed: 0,
    },
    earnings: {
      totalEarned: 0,
      weeklyIncrease: 0,
      incentives: 0,
      bonusesEarned: 0,
    },
    meta: {
      currency: "PHP",
      timeframe: "month_to_date",
      derivedFrom: reason,
    },
  };
}

function formatRelayBookingRows(
  rows: Array<{
    id: string;
    tracking_number?: string | null;
    pickup_address?: string | null;
    delivery_address?: string | null;
    status?: string | null;
    created_at?: string | null;
    receiver_name?: string | null;
    service_id?: string | null;
    delivery_mode?: string | null;
    drop_off_point_id?: string | null;
    parcel_draft_items?: Array<{ quantity?: number | null; item_type?: string | null }> | null;
  }>,
) {
  return rows.map((row) => ({
    draftId: row.id,
    trackingNumber: row.tracking_number,
    qrCodePayload: row.tracking_number || row.id,
    pickupAddress: row.pickup_address,
    deliveryAddress: row.delivery_address,
    receiverName: row.receiver_name,
    status: row.status,
    serviceId: row.service_id,
    deliveryMode: row.delivery_mode,
    isBulk: row.service_id === "pakibusiness",
    totalParcels: (row.parcel_draft_items ?? []).reduce(
      (sum, item) => sum + Number(item.quantity ?? 0),
      0,
    ),
    currentLocation: row.drop_off_point_id || row.pickup_address,
    progressLabel: row.status === "submitted" ? "Relay booking confirmed" : row.status || "Awaiting operator processing",
    progressPercentage: row.status === "submitted" ? 20 : 0,
    dropOffPoint: row.drop_off_point_id
      ? {
          id: row.drop_off_point_id,
          name: null,
          address: null,
        }
      : null,
    createdAt: row.created_at,
  }));
}

function formatTimeLabel(value?: string | null) {
  if (!value) return undefined;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;

  return date.toLocaleTimeString("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getParcelDraftRelation(
  value: HubParcelRow["parcel_drafts"] | ParcelHubRecordLookupRow["parcel_drafts"],
) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function mapParcelStatus(value: string) {
  if (value === "picked_up") return "picked-up";
  return value;
}

function isInvalidSchemaError(error: unknown) {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");

  return message.toLowerCase().includes("invalid schema");
}

function mapDraftStatusToHubStatus(value: string | null | undefined) {
  if (value === "delivered") return "picked_up";
  if (value === "picked_up") return "picked_up";
  if (value === "out_for_delivery") return "dispatched";
  if (value === "cancelled" || value === "lost") return value;
  return "stored";
}

function mapParcelStatusToDatabase(value: string) {
  if (value === "picked-up") return "picked_up";
  return value;
}

function formatHubParcelRow(row: HubParcelRow) {
  const draft = getParcelDraftRelation(row.parcel_drafts);
  const storageLocation = row.storage_location || "Drop-off point";
  const pickedUpAt = row.dispatched_at || row.picked_up_at || null;
  return {
    id: row.id,
    trackingNumber: draft?.tracking_number || row.id,
    sender: draft?.sender_name || "Unknown Sender",
    recipient: draft?.receiver_name || "Unknown Recipient",
    status: mapParcelStatus(row.status),
    arrivalTime: formatTimeLabel(row.received_at),
    pickupTime: formatTimeLabel(pickedUpAt),
    storageLocation,
    progressLabel: row.status,
    progressPercentage: row.status === "picked_up" ? 100 : 0,
    currentLocation: storageLocation,
  };
}

function asTrimmedString(value: unknown) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function mapCapacityToStorage(value: string) {
  if (value === "Full") return 0;
  if (value === "Medium") return 50;
  return 100;
}

function mapDropOffPointProfile(row: DropOffPointProfileRow) {
  const capacity = String(row.storage_capacity ?? "High");
  const mappedCapacity = ["High", "Medium", "Full"].includes(capacity)
    ? capacity
    : Number(capacity) <= 0
      ? "Full"
      : Number(capacity) < 20
        ? "Medium"
        : "High";

  return {
    id: row.id,
    name: row.name || "",
    address: row.address || "",
    status: row.is_active ? "Open" : "Closed",
    capacity: mappedCapacity,
    distance: null,
    latitude: row.latitude === null ? null : Number(row.latitude ?? row.lat ?? null),
    longitude: row.lng === null ? null : Number(row.lng ?? null),
    isActive: Boolean(row.is_active),
    updatedAt: null,
  };
}

@Injectable()
export class OperatorDashboardService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly parcelDraftsRepository: ParcelDraftsRepository,
    private readonly customerNotificationsService: CustomerNotificationsService,
  ) {}

  private async findActiveHubId(operatorUserId: string) {
    const admin = this.supabaseService.createAdminClient();
    const { data, error } = await admin.schema("routing").from("operator_hubs")
      .select("id")
      .eq("owner_user_id", operatorUserId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (error) {
      throw new InternalServerErrorException("Unable to load operator dashboard metrics.");
    }

    return data?.id ?? null;
  }

  private ensureOperator(session: SessionPayload) {
    if (session.role !== "operator") {
      throw new ForbiddenException("Only operators can access this dashboard.");
    }
  }

  private async requireActiveHubId(session: SessionPayload) {
    this.ensureOperator(session);
    const hubId = await this.findActiveHubId(session.userId);

    if (!hubId) {
      throw new BadRequestException("Assign this operator to a hub before using this feature.");
    }

    return hubId;
  }

  async getDropOffPointProfile(session: SessionPayload) {
    this.ensureOperator(session);

    const admin = this.supabaseService.createAdminClient();
    const { data, error } = await admin.schema("routing").from("operator_hubs")
      .select("id, owner_user_id, code, name, address, storage_capacity, lat, lng, is_active, geofence_on")
      .eq("owner_user_id", session.userId)
      .limit(1)
      .maybeSingle<DropOffPointProfileRow>();

    if (error) {
      throw new InternalServerErrorException("Unable to load drop-off point profile.");
    }

    return {
      dropOffPoint: data ? mapDropOffPointProfile(data) : null,
    };
  }

  async updateDropOffPointProfile(session: SessionPayload, body: Record<string, unknown>) {
    this.ensureOperator(session);

    const name = asTrimmedString(body.name);
    const address = asTrimmedString(body.address);
    const status = asTrimmedString(body.status) ?? "Open";
    const capacity = asTrimmedString(body.capacity) ?? "High";

    if (!name || !address) {
      throw new BadRequestException("Drop-off point name and address are required.");
    }

    if (!["Open", "Busy", "Closed"].includes(status)) {
      throw new BadRequestException("Drop-off point status is invalid.");
    }

    if (!["High", "Medium", "Full"].includes(capacity)) {
      throw new BadRequestException("Drop-off point capacity is invalid.");
    }

    const admin = this.supabaseService.createAdminClient();
    const existing = await admin.schema("routing").from("operator_hubs")
      .select("id")
      .eq("owner_user_id", session.userId)
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (existing.error) {
      throw new InternalServerErrorException("Unable to validate drop-off point profile.");
    }

    const id = existing.data?.id ?? randomUUID();
    const payload = {
      id,
      owner_user_id: session.userId,
      code: `HUB-${id.slice(0, 8).toUpperCase()}`,
      name,
      address,
      storage_capacity: mapCapacityToStorage(capacity),
      is_active: status !== "Closed",
      geofence_on: true,
    };

    const result = existing.data
      ? await admin.schema("routing").from("operator_hubs")
          .update(payload)
          .eq("id", existing.data.id)
          .select("id, owner_user_id, code, name, address, storage_capacity, lat, lng, is_active, geofence_on")
          .single<DropOffPointProfileRow>()
      : await admin.schema("routing").from("operator_hubs")
          .insert(payload)
          .select("id, owner_user_id, code, name, address, storage_capacity, lat, lng, is_active, geofence_on")
          .single<DropOffPointProfileRow>();

    if (result.error || !result.data) {
      throw new InternalServerErrorException("Unable to save drop-off point profile.");
    }

    return {
      dropOffPoint: mapDropOffPointProfile(result.data),
      message: "Drop-off point profile updated successfully.",
    };
  }

  private async listHubParcelRows(hubId: string) {
    const admin = this.supabaseService.createAdminClient();
    await this.ensureHubRecordsForAssignedRelayBookings(hubId);

    const { data, error } = await admin.schema("location").from("parcel_hub_records")
      .select(
        `
          id,
          hub_id,
          parcel_draft_id,
          status,
          storage_location,
          received_at,
          dispatched_at
        `,
      )
      .eq("hub_id", hubId)
      .order("received_at", { ascending: false })
      .limit(50);

    if (error) {
      if (isInvalidSchemaError(error)) {
        return this.listHubParcelRowsFromParcelDrafts(hubId);
      }

      throw new InternalServerErrorException("Unable to load operator parcels.");
    }

    return this.attachDraftsToHubRows((data ?? []) as HubParcelRow[]);
  }

  private async listHubParcelRowsFromParcelDrafts(hubId: string) {
    const admin = this.supabaseService.createAdminClient();
    const { data, error } = await admin.schema("parcel").from("parcel_drafts")
      .select("id, user_id, tracking_number, sender_name, receiver_name, status")
      .eq("service_id", "pakishare")
      .eq("drop_off_point_id", hubId)
      .in("status", ["draft", "submitted", "picked_up", "out_for_delivery", "delivered", "lost"])
      .order("tracking_number", { ascending: false })
      .limit(50);

    if (error) {
      throw new InternalServerErrorException("Unable to load operator parcels.");
    }

    return ((data ?? []) as ParcelDraftHubFallbackRow[]).map((draft) => ({
      id: draft.id,
      hub_id: hubId,
      parcel_draft_id: draft.id,
      status: mapDraftStatusToHubStatus(draft.status),
      storage_location: "Drop-off point",
      received_at: null,
      dispatched_at: null,
      parcel_drafts: {
        id: draft.id,
        user_id: draft.user_id ?? null,
        tracking_number: draft.tracking_number ?? null,
        sender_name: draft.sender_name ?? null,
        receiver_name: draft.receiver_name ?? null,
      },
    }));
  }

  private async ensureHubRecordsForAssignedRelayBookings(hubId: string) {
    const admin = this.supabaseService.createAdminClient();
    const draftsResult = await admin.schema("parcel").from("parcel_drafts")
      .select("id, tracking_number, status, drop_off_point_id")
      .eq("service_id", "pakishare")
      .eq("drop_off_point_id", hubId)
      .in("status", ["submitted", "incoming", "stored"]);

    if (draftsResult.error) {
      console.warn(
        "[operator-dashboard] unable to load assigned relay bookings for parcel management",
        draftsResult.error.message,
      );
      return;
    }

    const relayDrafts = (draftsResult.data ?? []) as AssignedRelayDraftRow[];
    const draftIds = relayDrafts.map((draft) => draft.id);
    if (draftIds.length === 0) {
      return;
    }

    const existingResult = await admin.schema("location").from("parcel_hub_records")
      .select("parcel_draft_id")
      .eq("hub_id", hubId)
      .in("parcel_draft_id", draftIds);

    if (existingResult.error) {
      if (isInvalidSchemaError(existingResult.error)) {
        return;
      }

      console.warn(
        "[operator-dashboard] unable to check existing parcel hub records",
        existingResult.error.message,
      );
      return;
    }

    const existingDraftIds = new Set(
      ((existingResult.data ?? []) as Array<{ parcel_draft_id?: string | null }>)
        .map((record) => record.parcel_draft_id)
        .filter((value): value is string => Boolean(value)),
    );
    const missingRecords = relayDrafts
      .filter((draft) => !existingDraftIds.has(draft.id))
      .map((draft) => ({
        id: randomUUID(),
        parcel_draft_id: draft.id,
        hub_id: hubId,
        status: draft.status === "stored" ? "stored" : "incoming",
        storage_location: null,
        received_at: null,
        dispatched_at: null,
      }));

    if (missingRecords.length === 0) {
      return;
    }

    const insertResult = await admin.schema("location").from("parcel_hub_records")
      .insert(missingRecords);

    if (insertResult.error) {
      console.warn(
        "[operator-dashboard] unable to materialize relay bookings into hub records",
        insertResult.error.message,
      );
    }
  }

  private async attachDraftsToHubRows<T extends { parcel_draft_id?: string | null }>(
    rows: T[],
  ): Promise<Array<T & { parcel_drafts: ParcelHubRecordLookupRow["parcel_drafts"] }>> {
    const draftIds = [
      ...new Set(rows.map((row) => row.parcel_draft_id ?? null).filter((value): value is string => Boolean(value))),
    ];

    if (draftIds.length === 0) {
      return rows.map((row) => ({ ...row, parcel_drafts: null }));
    }

    const admin = this.supabaseService.createAdminClient();
    const draftsResult = await admin.schema("parcel").from("parcel_drafts")
      .select("id, user_id, tracking_number, sender_name, receiver_name")
      .in("id", draftIds);

    if (draftsResult.error) {
      throw new InternalServerErrorException("Unable to load parcel draft details.");
    }

    const draftsById = new Map((draftsResult.data ?? []).map((draft) => [draft.id, draft]));

    return rows.map((row) => ({
      ...row,
      parcel_drafts: row.parcel_draft_id ? draftsById.get(row.parcel_draft_id) ?? null : null,
    }));
  }

  private async loadKpiMetrics(hubId: string, dayStart: Date) {
    const admin = this.supabaseService.createAdminClient();
    const dayEnd = addDays(dayStart, 1);

    const [
      incomingTodayResult,
      currentlyStoredResult,
      pickedUpTodayResult,
      customersServedResult,
    ] = await Promise.all([
      admin.schema("location").from("parcel_hub_records")
        .select("id", { count: "exact", head: true })
        .eq("hub_id", hubId)
        .gte("received_at", dayStart.toISOString())
        .lt("received_at", dayEnd.toISOString()),
      admin.schema("location").from("parcel_hub_records")
        .select("id", { count: "exact", head: true })
        .eq("hub_id", hubId)
        .eq("status", "stored"),
      admin.schema("location").from("parcel_hub_records")
        .select("id", { count: "exact", head: true })
        .eq("hub_id", hubId)
        .gte("dispatched_at", dayStart.toISOString())
        .lt("dispatched_at", dayEnd.toISOString()),
      admin.schema("location").from("parcel_hub_records")
        .select("parcel_draft_id")
        .eq("hub_id", hubId)
        .gte("received_at", dayStart.toISOString())
        .lt("received_at", dayEnd.toISOString()),
    ]);

    if (
      incomingTodayResult.error ||
      currentlyStoredResult.error ||
      pickedUpTodayResult.error ||
      customersServedResult.error
    ) {
      const locationErrors = [
        incomingTodayResult.error,
        currentlyStoredResult.error,
        pickedUpTodayResult.error,
        customersServedResult.error,
      ].filter(Boolean);

      if (locationErrors.some(isInvalidSchemaError)) {
        return this.loadKpiMetricsFromParcelDrafts(hubId, dayStart, dayEnd);
      }

      throw new InternalServerErrorException("Unable to load operator dashboard metrics.");
    }

    const customersServedRows = (customersServedResult.data ?? []) as ParcelHubRecordRow[];
    const customersServedDraftIds = customersServedRows
      .map((row) => row.parcel_draft_id ?? null)
      .filter((value): value is string => Boolean(value));
    let customersServed = 0;
    if (customersServedDraftIds.length > 0) {
      const draftsResult = await admin.schema("parcel").from("parcel_drafts")
        .select("id, user_id")
        .in("id", customersServedDraftIds);
      if (!draftsResult.error) {
        customersServed = new Set(
          (draftsResult.data ?? [])
            .map((draft) => draft.user_id ?? null)
            .filter((value): value is string => Boolean(value)),
        ).size;
      }
    }

    return {
      incomingToday: incomingTodayResult.count ?? 0,
      currentlyStored: currentlyStoredResult.count ?? 0,
      pickedUpToday: pickedUpTodayResult.count ?? 0,
      customersServed,
    };
  }

  private async loadKpiMetricsFromParcelDrafts(hubId: string, dayStart: Date, dayEnd: Date) {
    const admin = this.supabaseService.createAdminClient();
    const { data, error } = await admin.schema("parcel").from("parcel_drafts")
      .select("id, user_id, status")
      .eq("service_id", "pakishare")
      .eq("drop_off_point_id", hubId);

    if (error) {
      throw new InternalServerErrorException("Unable to load operator dashboard metrics.");
    }

    const rows = (data ?? []) as ParcelDraftHubFallbackRow[];
    const activeRows = rows.filter((row) => !["cancelled", "lost"].includes(String(row.status ?? "")));
    const todayRows: ParcelDraftHubFallbackRow[] = [];
    const pickedUpTodayRows: ParcelDraftHubFallbackRow[] = [];

    return {
      incomingToday: todayRows.length,
      currentlyStored: activeRows.filter((row) => row.status !== "delivered").length,
      pickedUpToday: pickedUpTodayRows.length,
      customersServed: new Set(
        todayRows
          .map((row) => row.user_id ?? null)
          .filter((value): value is string => Boolean(value)),
      ).size,
    };
  }

  private async loadEarningsMetrics(
    operatorUserId: string,
    hubId: string,
    weekStart: Date,
    monthStart: Date,
  ) {
    const admin = this.supabaseService.createAdminClient();

    const [monthlyEarningsResult, weeklyEarningsResult, incentivesResult] = await Promise.all([
      admin.schema("routing").from("operator_earnings")
        .select("amount")
        .eq("hub_id", hubId)
        .gte("earned_at", monthStart.toISOString()),
      admin.schema("routing").from("operator_earnings")
        .select("amount")
        .eq("hub_id", hubId)
        .gte("earned_at", weekStart.toISOString()),
      admin.schema("routing").from("operator_incentives")
        .select("amount", { count: "exact" })
        .eq("hub_id", hubId)
        .gte("awarded_at", monthStart.toISOString()),
    ]);

    if (
      monthlyEarningsResult.error ||
      weeklyEarningsResult.error ||
      incentivesResult.error
    ) {
      throw new InternalServerErrorException("Unable to load operator dashboard metrics.");
    }

    return {
      totalEarned: sumAmounts(monthlyEarningsResult.data as MonetaryRow[] | null),
      weeklyIncrease: sumAmounts(weeklyEarningsResult.data as MonetaryRow[] | null),
      incentives: sumAmounts(incentivesResult.data as MonetaryRow[] | null),
      bonusesEarned: incentivesResult.count ?? 0,
    };
  }

  async registerManualEntry(session: SessionPayload, trackingNumber: string) {
    if (session.role !== "operator") {
      throw new ForbiddenException("Only operators can register parcels manually.");
    }

    const normalizedTrackingNumber = trackingNumber.trim();
    if (!normalizedTrackingNumber) {
      throw new BadRequestException("Tracking number is required.");
    }

    const hubId = await this.findActiveHubId(session.userId);
    if (!hubId) {
      throw new BadRequestException("Assign this operator to a hub before using manual entry.");
    }

    const admin = this.supabaseService.createAdminClient();

    const { data: parcelDraft, error: parcelDraftError } = await admin.schema("parcel").from("parcel_drafts")
      .select("id, tracking_number, sender_name, receiver_name, status")
      .eq("tracking_number", normalizedTrackingNumber)
      .eq("status", "submitted")
      .maybeSingle<ParcelDraftLookupRow>();

    if (parcelDraftError) {
      throw new InternalServerErrorException("Unable to validate the tracking number.");
    }

    if (!parcelDraft) {
      throw new NotFoundException("No submitted parcel was found for that tracking number.");
    }

    const { data: existingRecord, error: existingRecordError } = await admin.schema("location").from("parcel_hub_records")
      .select("id, hub_id, parcel_draft_id, status, storage_location, received_at, dispatched_at")
      .eq("parcel_draft_id", parcelDraft.id)
      .maybeSingle<ParcelHubRecordLookupRow>();

    if (existingRecordError) {
      throw new InternalServerErrorException("Unable to check existing parcel hub records.");
    }

    let parcelRecord = existingRecord;

    if (existingRecord) {
      if (existingRecord.hub_id !== hubId) {
        throw new BadRequestException("This parcel is already registered at a different hub.");
      }
    } else {
      const nowIso = new Date().toISOString();
      const { data: createdRecord, error: createError } = await admin.schema("location").from("parcel_hub_records")
        .insert({
          id: randomUUID(),
          parcel_draft_id: parcelDraft.id,
          hub_id: hubId,
          status: "incoming",
          storage_location: null,
          received_at: nowIso,
          dispatched_at: null,
        })
        .select("id, hub_id, parcel_draft_id, status, storage_location, received_at, dispatched_at")
        .single<ParcelHubRecordLookupRow>();

      if (createError || !createdRecord) {
        throw new InternalServerErrorException("Unable to register the parcel at this hub.");
      }

      parcelRecord = createdRecord;
    }

    return {
      parcel: {
        id: parcelRecord.id,
        trackingNumber: parcelDraft.tracking_number || normalizedTrackingNumber,
        sender: parcelDraft.sender_name || "Unknown Sender",
        recipient: parcelDraft.receiver_name || "Unknown Recipient",
        status: mapParcelStatus(parcelRecord.status),
        arrivalTime: formatTimeLabel(parcelRecord.received_at),
        storageLocation: parcelRecord.storage_location || "Drop-off point",
      },
    };
  }
  async getDashboard(session: SessionPayload) {
    this.ensureOperator(session);

    const now = new Date();
    const dayStart = startOfPhilippineDay(now);
    const weekStart = startOfPhilippineWeek(now);
    const monthStart = startOfPhilippineMonth(now);

    const hubId = await this.findActiveHubId(session.userId);
    if (!hubId) {
      return createEmptyDashboard("operator hub tables");
    }

    const [kpis, earnings] = await Promise.all([
      this.loadKpiMetrics(hubId, dayStart),
      this.loadEarningsMetrics(session.userId, hubId, weekStart, monthStart),
    ]);

    return {
      kpis,
      earnings,
      meta: {
        currency: "PHP",
        timeframe: "month_to_date",
        derivedFrom: "operator hub records and payout tables",
      },
    };
  }

  async getParcels(session: SessionPayload) {
    const hubId = await this.requireActiveHubId(session);
    const rows = await this.listHubParcelRows(hubId);

    return {
      parcels: rows.map(formatHubParcelRow),
      meta: {
        hubId,
      },
    };
  }

  async getReports(session: SessionPayload) {
    const hubId = await this.requireActiveHubId(session);
    const rows = await this.listHubParcelRows(hubId);

    return {
      reports: rows
        .map((row) => ({
          row,
          draft: getParcelDraftRelation(row.parcel_drafts),
        }))
        .filter(({ row }) => row.status === "lost")
        .map(({ row, draft }) => ({
          id: row.id,
          trackingNumber: draft?.tracking_number || row.id,
          status: mapParcelStatus(row.status),
          details: "Lost parcel reported",
          reportedAt: row.received_at,
        })),
      meta: {
        hubId,
      },
    };
  }

  async updateParcelStatus(session: SessionPayload, recordId: string, nextStatus: string) {
    const hubId = await this.requireActiveHubId(session);
    const normalizedStatus = nextStatus.trim();
    const supportedStatuses = new Set(["incoming", "stored", "picked-up", "dispatched"]);

    if (!supportedStatuses.has(normalizedStatus)) {
      throw new BadRequestException("Unsupported parcel status.");
    }

    const admin = this.supabaseService.createAdminClient();
    const { data: record, error: recordError } = await admin.schema("location").from("parcel_hub_records")
      .select(
        `
          id,
          hub_id,
          parcel_draft_id,
          status,
          storage_location,
          received_at,
          dispatched_at
        `,
      )
      .eq("id", recordId)
      .eq("hub_id", hubId)
      .maybeSingle<ParcelHubRecordLookupRow>();

    if (recordError) {
      throw new InternalServerErrorException("Unable to load the parcel record.");
    }

    if (!record) {
      throw new NotFoundException("Parcel record not found.");
    }
    const recordWithDraft = (await this.attachDraftsToHubRows([record as HubParcelRow]))[0];
    const recordDraft = getParcelDraftRelation(recordWithDraft?.parcel_drafts ?? null);

    const nowIso = new Date().toISOString();
    const databaseStatus = mapParcelStatusToDatabase(normalizedStatus);
    const parcelRecordPatch: Record<string, unknown> = {
      status: databaseStatus,
    };

    if (databaseStatus === "picked_up") {
      parcelRecordPatch.dispatched_at = nowIso;
    }

    const { error: updateRecordError } = await admin.schema("location").from("parcel_hub_records")
      .update(parcelRecordPatch)
      .eq("id", recordId)
      .eq("hub_id", hubId);

    if (updateRecordError) {
      throw new InternalServerErrorException("Unable to update parcel status.");
    }

    const trackingProgressMap = {
      incoming: {
        currentLocation: "Drop-off point receiving area",
        progressLabel: "Parcel received at drop-off point",
        progressPercentage: 40,
      },
      stored: {
        currentLocation: record.storage_location || "Drop-off point storage shelf",
        progressLabel: "Parcel stored at drop-off point",
        progressPercentage: 55,
      },
      "picked-up": {
        currentLocation: "Picked up by recipient",
        progressLabel: "Parcel picked up by recipient",
        progressPercentage: 100,
      },
      dispatched: {
        currentLocation: "Dispatched from drop-off point",
        progressLabel: "Parcel dispatched from drop-off point",
        progressPercentage: 80,
      },
    } as const;

    const progress = trackingProgressMap[normalizedStatus as keyof typeof trackingProgressMap];
    const draftStatus = normalizedStatus === "picked-up" ? "delivered" : databaseStatus;
    const { error: updateDraftError } = await admin.schema("parcel").from("parcel_drafts")
      .update({ status: draftStatus })
      .eq("id", recordDraft?.id ?? "");

    if (updateDraftError) {
      throw new InternalServerErrorException("Unable to update parcel tracking progress.");
    }

    if (recordDraft?.id) {
      await this.recordParcelTrackingEvent(recordDraft.id, draftStatus, progress.currentLocation, nowIso);
    }

    if (normalizedStatus === "picked-up" && recordDraft?.user_id) {
      await this.customerNotificationsService.createNotification(
        recordDraft.user_id,
        "delivery",
        "Parcel picked up",
        `Your parcel ${recordDraft.tracking_number || ""} was picked up successfully.`,
      );
    }

    const refreshedRows = await this.listHubParcelRows(hubId);
    const refreshed = refreshedRows.find((item) => item.id === recordId);

    if (!refreshed) {
      throw new InternalServerErrorException("Unable to load the updated parcel status.");
    }

    return {
      parcel: formatHubParcelRow(refreshed),
    };
  }

  async reportLostParcel(session: SessionPayload, trackingNumber: string, details: string) {
    const hubId = await this.requireActiveHubId(session);
    const normalizedTrackingNumber = trackingNumber.trim();

    if (!normalizedTrackingNumber) {
      throw new BadRequestException("Tracking number is required.");
    }

    const admin = this.supabaseService.createAdminClient();
    const draftResult = await admin.schema("parcel").from("parcel_drafts")
      .select("id, user_id, tracking_number, sender_name, receiver_name")
      .eq("tracking_number", normalizedTrackingNumber)
      .maybeSingle();

    if (draftResult.error) {
      throw new InternalServerErrorException("Unable to load the parcel for reporting.");
    }

    if (!draftResult.data) {
      throw new NotFoundException("No parcel was found for that tracking number at this hub.");
    }

    const { data: record, error: recordError } = await admin.schema("location").from("parcel_hub_records")
      .select(
        `
          id,
          hub_id,
          parcel_draft_id,
          status,
          storage_location,
          received_at,
          dispatched_at
        `,
      )
      .eq("hub_id", hubId)
      .eq("parcel_draft_id", draftResult.data.id)
      .maybeSingle<ParcelHubRecordLookupRow>();

    if (recordError) {
      throw new InternalServerErrorException("Unable to load the parcel for reporting.");
    }

    if (!record) {
      throw new NotFoundException("No parcel was found for that tracking number at this hub.");
    }
    const recordDraft = draftResult.data;

    if (!recordDraft?.id) {
      throw new NotFoundException("No parcel was found for that tracking number at this hub.");
    }

    const label = details.trim()
      ? `Lost parcel reported: ${details.trim()}`
      : "Lost parcel reported by operator";

    const { error: updateDraftError } = await admin.schema("parcel").from("parcel_drafts")
      .update({ status: "lost" })
      .eq("id", recordDraft.id);

    if (updateDraftError) {
      throw new InternalServerErrorException("Unable to save the lost parcel report.");
    }

    await this.recordParcelTrackingEvent(
      recordDraft.id,
      "lost",
      record.storage_location || "Operator hub investigation queue",
      new Date().toISOString(),
    );

    if (recordDraft.user_id) {
      await this.customerNotificationsService.createNotification(
        recordDraft.user_id,
        "delivery",
        "Lost parcel report submitted",
        `A report was filed for parcel ${normalizedTrackingNumber}. Our team is now investigating.`,
      );
    }

    return {
      report: {
        id: record.id,
        trackingNumber: normalizedTrackingNumber,
        details: label,
        status: mapParcelStatus(record.status),
      },
    };
  }

  async getRelayBookings(session: SessionPayload) {
    this.ensureOperator(session);

    const hubId = await this.findActiveHubId(session.userId);
    const primaryResult = hubId
      ? await this.parcelDraftsRepository.listRelayBookingsForHub(hubId)
      : null;

    if (primaryResult?.error) {
      throw new InternalServerErrorException("Unable to load relay bookings.");
    }

    const matchedRows = primaryResult?.data ?? [];
    if (matchedRows.length > 0) {
      return {
        bookings: formatRelayBookingRows(matchedRows),
        meta: {
          hubId,
          matchedBy: "active_hub",
        },
      };
    }

    const fallbackResult = await this.parcelDraftsRepository.listRecentRelayBookings();
    if (fallbackResult.error) {
      throw new InternalServerErrorException("Unable to load relay bookings.");
    }

    return {
      bookings: formatRelayBookingRows(fallbackResult.data ?? []),
      meta: {
        hubId,
        matchedBy: hubId ? "fallback_recent_relay_bookings" : "no_active_hub_fallback",
      },
    };
  }

  async updateRelayBookingStatus(
    session: SessionPayload,
    draftId: string,
    input: {
      currentLocation?: unknown;
      progressLabel?: unknown;
      progressPercentage?: unknown;
    },
  ) {
    this.ensureOperator(session);

    const relayBooking = await this.parcelDraftsRepository.findRelayBookingById(draftId);
    if (relayBooking.error || !relayBooking.data) {
      throw new NotFoundException("Relay booking not found.");
    }

    const currentLocation = String(
      input.currentLocation ??
        relayBooking.data.drop_off_point_id ??
        "Drop-off point",
    ).trim();
    const progressLabel = String(
      input.progressLabel ?? "Parcel received at drop-off point",
    ).trim();
    const progressPercentage = Number(
      input.progressPercentage ?? 50,
    );

    if (!currentLocation || !progressLabel) {
      throw new BadRequestException("Current location and progress label are required.");
    }

    if (!Number.isFinite(progressPercentage) || progressPercentage < 0 || progressPercentage > 100) {
      throw new BadRequestException("Progress percentage must be between 0 and 100.");
    }

    const nextStatus = progressPercentage >= 100 ? "delivered" : "submitted";
    const updateResult = await this.parcelDraftsRepository.updateRelayBookingTracking(draftId, {
      status: nextStatus,
    });

    if (updateResult.error || !updateResult.data) {
      throw new InternalServerErrorException("Unable to update relay booking status.");
    }

    await this.customerNotificationsService.createNotification(
      relayBooking.data.user_id,
      "delivery",
      "Parcel status updated",
      `${progressLabel}. Current location: ${currentLocation}.`,
    );

    const admin = this.supabaseService.createAdminClient();
    await this.recordParcelTrackingEvent(draftId, nextStatus, currentLocation, new Date().toISOString());

    return {
      draftId,
      trackingNumber: updateResult.data.tracking_number,
      currentLocation,
      progressLabel,
      progressPercentage,
    };
  }

  private async recordParcelTrackingEvent(
    parcelDraftId: string,
    status: string,
    locationLabel: string,
    occurredAt: string,
  ) {
    const admin = this.supabaseService.createAdminClient();
    const { error } = await admin.schema("location").from("parcel_tracking_events").insert({
      id: randomUUID(),
      parcel_draft_id: parcelDraftId,
      status,
      location_label: locationLabel,
      occurred_at: occurredAt,
    });

    if (error) {
      console.warn(
        "[operator-dashboard] parcel status saved but tracking event could not be created",
        error.message,
      );
    }
  }
}
