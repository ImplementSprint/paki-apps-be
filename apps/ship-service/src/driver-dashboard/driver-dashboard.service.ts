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
import { GoogleMapsService } from "../google-maps/google-maps.service";
import { SupabaseService } from "../supabase/supabase.service";

type JobStatus = "available" | "in-progress" | "completed";
type ParcelStatus = "picked-up" | "out-for-delivery" | "delivered" | null;

type DriverJobRow = {
  id: string;
  job_number: string;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  distance_text?: string | null;
  earnings?: number | string | null;
  earnings_amount?: number | string | null;
  status: JobStatus;
  parcel_status?: ParcelStatus;
  customer_name?: string | null;
  package_size?: "Small" | "Medium" | "Large" | null;
  time_limit_text?: string | null;
  customer_phone?: string | null;
  package_description?: string | null;
  special_instructions?: string | null;
  rating: number | string | null;
  parcel_draft_id: string | null;
  driver_id: string | null;
  accepted_at?: string | null;
  picked_up_at?: string | null;
  delivered_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type DriverProfileRow = {
  id: string;
  is_online: boolean;
};

type ParcelDraftJobDetailsRow = {
  id: string;
  pickup_address: string | null;
  delivery_address: string | null;
  sender_name: string | null;
  sender_phone: string | null;
  receiver_name: string | null;
  receiver_phone: string | null;
  service_price: number | string | null;
};

type ParcelDraftItemJobDetailsRow = {
  parcel_draft_id: string;
  item_type: string | null;
  size: string | null;
  weight_text: string | null;
  delivery_guarantee: string | null;
  quantity: number | string | null;
};

type DriverLocation = {
  lat: number;
  lng: number;
};

const VALID_PARCEL_STATUSES = new Set<Exclude<ParcelStatus, null>>([
  "picked-up",
  "out-for-delivery",
  "delivered",
]);
const PH_TIMEZONE_OFFSET_HOURS = 8;
const AVAILABLE_JOB_RADIUS_METERS = 2000;

function startOfPhilippineDay(now = new Date()) {
  const shifted = new Date(now.getTime() + PH_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - PH_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000);
}

function asNumber(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(value);
}

function mapJob(row: DriverJobRow) {
  const earningsAmount = asNumber(row.earnings ?? row.earnings_amount);
  return {
    id: row.id,
    jobNumber: row.job_number,
    pickup: row.pickup_address || "Pickup address unavailable",
    dropoff: row.dropoff_address || "Drop-off address unavailable",
    distance: row.distance_text || "TBD",
    earningsAmount,
    earnings: formatCurrency(earningsAmount),
    status: row.status,
    parcelStatus: row.parcel_status ?? null,
    customerName: row.customer_name || "Customer",
    packageSize: row.package_size || "Small",
    timeLimit: row.time_limit_text || undefined,
    customerPhone: row.customer_phone || undefined,
    packageDescription: row.package_description || undefined,
    specialInstructions: row.special_instructions || undefined,
    rating: row.rating === null ? null : asNumber(row.rating),
    parcelDraftId: row.parcel_draft_id,
    acceptedAt: row.accepted_at,
    pickedUpAt: row.picked_up_at,
    deliveredAt: row.delivered_at,
    completedAt: row.completed_at,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? row.created_at ?? null,
  };
}

function getParcelStatusLabel(parcelStatus: Exclude<ParcelStatus, null>) {
  if (parcelStatus === "picked-up") return "Picked Up";
  if (parcelStatus === "out-for-delivery") return "Out for Delivery";
  return "Delivered";
}

function getCustomerStatusMessage(
  parcelStatus: Exclude<ParcelStatus, null>,
  trackingNumber: string,
) {
  if (parcelStatus === "picked-up") {
    return `Your parcel ${trackingNumber} has been picked up by the driver.`;
  }

  if (parcelStatus === "out-for-delivery") {
    return `Your parcel ${trackingNumber} is out for delivery.`;
  }

  return `Your parcel ${trackingNumber} has been delivered.`;
}

function mapPackageSize(size: string | null | undefined): "Small" | "Medium" | "Large" {
  const normalized = String(size ?? "").trim().toUpperCase();
  if (normalized === "S") return "Small";
  if (normalized === "M") return "Medium";
  return "Large";
}

function describePackage(item: ParcelDraftItemJobDetailsRow | undefined) {
  if (!item) return undefined;

  const type = item.item_type || "Parcel";
  const quantity = asNumber(item.quantity) || 1;
  const details = [
    item.weight_text ? `Weight: ${item.weight_text}` : null,
    item.delivery_guarantee ? `Cover: ${item.delivery_guarantee}` : null,
  ].filter(Boolean);

  return `${type} x${quantity}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
}

function readDriverLocation(input: Record<string, unknown> | undefined) {
  const lat = Number(input?.lat);
  const lng = Number(input?.lng);

  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  return { lat, lng };
}

@Injectable()
export class DriverDashboardService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly customerNotificationsService: CustomerNotificationsService,
    private readonly googleMapsService: GoogleMapsService,
  ) {}

  private assertDriver(session: SessionPayload) {
    if (session.role !== "driver") {
      throw new ForbiddenException("Only drivers can access this dashboard.");
    }
  }

  private async ensureDriverProfile(driverUserId: string) {
    const admin = this.supabaseService.createAdminClient();
    const existing = await admin.schema("driver").from("driver_profiles")
      .select("id, is_online")
      .eq("id", driverUserId)
      .maybeSingle<DriverProfileRow>();

    if (existing.error) {
      throw new InternalServerErrorException("Unable to load driver profile details.");
    }

    if (existing.data) {
      return existing.data;
    }

    const inserted = await admin.schema("driver").from("driver_profiles")
      .insert({
        id: driverUserId,
        is_online: false,
      })
      .select("id, is_online")
      .single<DriverProfileRow>();

    if (inserted.error || !inserted.data) {
      throw new InternalServerErrorException("Unable to initialize driver profile details.");
    }

    return inserted.data;
  }

  private async listDashboardJobs(driverUserId: string, driverLocation: DriverLocation | null) {
    const admin = this.supabaseService.createAdminClient();
    const [availableResult, assignedResult] = await Promise.all([
      admin.schema("driver").from("driver_jobs")
        .select("*")
        .eq("status", "available")
        .or(`driver_id.is.null,driver_id.eq.${driverUserId}`)
        .order("job_number", { ascending: false })
        .limit(25),
      admin.schema("driver").from("driver_jobs")
        .select("*")
        .eq("driver_id", driverUserId)
        .in("status", ["in-progress", "completed"])
        .order("job_number", { ascending: false })
        .limit(50),
    ]);

    if (availableResult.error || assignedResult.error) {
      throw new InternalServerErrorException("Unable to load driver jobs.");
    }

    const jobs = [
      ...((availableResult.data ?? []) as DriverJobRow[]),
      ...((assignedResult.data ?? []) as DriverJobRow[]),
    ];

    const enrichedJobs = await this.enrichJobsWithParcelDetails(jobs);
    return this.filterAvailableJobsByDriverLocation(enrichedJobs, driverLocation);
  }

  private async filterAvailableJobsByDriverLocation(
    jobs: DriverJobRow[],
    driverLocation: DriverLocation | null,
  ) {
    const assignedJobs = jobs.filter((job) => job.status !== "available");
    const availableJobs = jobs.filter((job) => job.status === "available");

    if (!driverLocation || availableJobs.length === 0) {
      return assignedJobs;
    }

    const pickupAddresses = availableJobs.map((job) => job.pickup_address?.trim() || "");
    const routablePickups = pickupAddresses.filter(Boolean);
    if (routablePickups.length === 0) {
      return assignedJobs;
    }

    try {
      const matrix = await this.googleMapsService.getDistanceMatrix(
        `${driverLocation.lat},${driverLocation.lng}`,
        routablePickups.join("|"),
      );
      const elements = matrix?.rows?.[0]?.elements ?? [];
      const pickupDistanceByAddress = new Map<string, number>();

      routablePickups.forEach((pickupAddress, index) => {
        const element = elements[index];
        const distanceMeters = Number(element?.distance?.value ?? Number.NaN);
        if (element?.status === "OK" && Number.isFinite(distanceMeters)) {
          pickupDistanceByAddress.set(pickupAddress, distanceMeters);
        }
      });

      return [
        ...availableJobs.filter((job) => {
          const pickupAddress = job.pickup_address?.trim();
          if (!pickupAddress) return false;

          const distanceMeters = pickupDistanceByAddress.get(pickupAddress);
          return typeof distanceMeters === "number" && distanceMeters <= AVAILABLE_JOB_RADIUS_METERS;
        }),
        ...assignedJobs,
      ];
    } catch (error) {
      console.warn(
        "[driver-dashboard] nearby available jobs could not be filtered",
        error instanceof Error ? error.message : error,
      );
      return assignedJobs;
    }
  }

  private async enrichJobsWithParcelDetails(jobs: DriverJobRow[]) {
    const draftIds = Array.from(
      new Set(jobs.map((job) => job.parcel_draft_id).filter((id): id is string => Boolean(id))),
    );

    if (draftIds.length === 0) {
      return jobs;
    }

    const admin = this.supabaseService.createAdminClient();
    const [draftsResult, itemsResult] = await Promise.all([
      admin.schema("parcel").from("parcel_drafts")
        .select("id, pickup_address, delivery_address, sender_name, sender_phone, receiver_name, receiver_phone, service_price")
        .in("id", draftIds),
      admin.schema("parcel").from("parcel_draft_items")
        .select("parcel_draft_id, item_type, size, weight_text, delivery_guarantee, quantity")
        .in("parcel_draft_id", draftIds),
    ]);

    if (draftsResult.error || itemsResult.error) {
      console.warn("[driver-dashboard] jobs loaded but parcel details could not be joined", {
        draftsError: draftsResult.error?.message,
        itemsError: itemsResult.error?.message,
      });
      return jobs;
    }

    const draftsById = new Map(
      ((draftsResult.data ?? []) as ParcelDraftJobDetailsRow[]).map((draft) => [draft.id, draft]),
    );
    const itemsByDraftId = new Map<string, ParcelDraftItemJobDetailsRow>();
    for (const item of (itemsResult.data ?? []) as ParcelDraftItemJobDetailsRow[]) {
      if (!itemsByDraftId.has(item.parcel_draft_id)) {
        itemsByDraftId.set(item.parcel_draft_id, item);
      }
    }

    return jobs.map((job) => {
      if (!job.parcel_draft_id) return job;

      const draft = draftsById.get(job.parcel_draft_id);
      if (!draft) return job;

      const item = itemsByDraftId.get(job.parcel_draft_id);
      return {
        ...job,
        pickup_address: job.pickup_address ?? draft.pickup_address,
        dropoff_address: job.dropoff_address ?? draft.delivery_address,
        customer_name: job.customer_name ?? draft.sender_name ?? draft.receiver_name,
        customer_phone: job.customer_phone ?? draft.sender_phone ?? draft.receiver_phone,
        earnings: job.earnings ?? draft.service_price,
        package_size: job.package_size ?? mapPackageSize(item?.size),
        package_description: job.package_description ?? describePackage(item),
      };
    });
  }

  private async loadDriverMetrics(driverUserId: string, now: Date) {
    const admin = this.supabaseService.createAdminClient();
    const dayStart = startOfPhilippineDay(now).toISOString();

    const [earningsTodayResult, deliveriesTodayResult, completedJobsResult] = await Promise.all([
      admin.schema("driver").from("driver_earnings")
        .select("amount")
        .eq("driver_id", driverUserId)
        .gte("earned_at", dayStart),
      admin.schema("driver").from("driver_jobs")
        .select("id", { count: "exact", head: true })
        .eq("driver_id", driverUserId)
        .eq("status", "completed"),
      admin.schema("driver").from("driver_jobs")
        .select("parcel_draft_id")
        .eq("driver_id", driverUserId)
        .eq("status", "completed"),
    ]);

    if (
      earningsTodayResult.error ||
      deliveriesTodayResult.error ||
      completedJobsResult.error
    ) {
      throw new InternalServerErrorException("Unable to load driver metrics.");
    }

    const earnings = (earningsTodayResult.data ?? []).reduce((total, row) => {
      return total + asNumber((row as { amount?: number | string | null }).amount);
    }, 0);

    const completedDraftIds = (completedJobsResult.data ?? [])
      .map((row) => (row as { parcel_draft_id?: string | null }).parcel_draft_id)
      .filter((id): id is string => Boolean(id));
    const reviewsResult = completedDraftIds.length > 0
      ? await admin.schema("parcel").from("parcel_reviews")
          .select("rating")
          .in("parcel_draft_id", completedDraftIds)
      : { data: [], error: null };

    if (reviewsResult.error) {
      throw new InternalServerErrorException("Unable to load driver metrics.");
    }

    const ratingValues = (reviewsResult.data ?? [])
      .map((row) => asNumber((row as { rating?: number | string | null }).rating))
      .filter((value) => value > 0);

    const ratingAverage =
      ratingValues.length > 0
        ? ratingValues.reduce((sum, value) => sum + value, 0) / ratingValues.length
        : null;

    return {
      todaysEarnings: earnings,
      deliveriesToday: deliveriesTodayResult.count ?? 0,
      ratingAverage,
    };
  }

  private async loadDashboardSnapshot(session: SessionPayload, driverLocation: DriverLocation | null) {
    const now = new Date();
    const [jobs, driverProfile, metrics] = await Promise.all([
      this.listDashboardJobs(session.userId, driverLocation),
      this.ensureDriverProfile(session.userId),
      this.loadDriverMetrics(session.userId, now),
    ]);

    return {
      metrics: {
        todaysEarnings: metrics.todaysEarnings,
        todaysEarningsLabel: formatCurrency(metrics.todaysEarnings),
        deliveriesToday: metrics.deliveriesToday,
        ratingAverage: metrics.ratingAverage,
        onlineSeconds: 0,
      },
      presence: {
        isOnline: driverProfile.is_online,
        currentSessionStartedAt: null,
        lastSeenAt: null,
      },
      jobs: jobs.map(mapJob),
      meta: {
        currency: "PHP",
        refreshedAt: now.toISOString(),
        source: "driver_jobs, driver_profiles",
        availableJobRadiusKm: AVAILABLE_JOB_RADIUS_METERS / 1000,
      },
    };
  }

  async getDashboard(session: SessionPayload, locationInput?: Record<string, unknown>) {
    this.assertDriver(session);
    return this.loadDashboardSnapshot(session, readDriverLocation(locationInput));
  }

  async updatePresence(
    session: SessionPayload,
    isOnline: boolean,
    locationInput?: Record<string, unknown>,
  ) {
    this.assertDriver(session);
    const admin = this.supabaseService.createAdminClient();
    const updates: Record<string, unknown> = {
      is_online: isOnline,
    };

    const result = await admin.schema("driver").from("driver_profiles")
      .update(updates)
      .eq("id", session.userId);

    if (result.error) {
      throw new InternalServerErrorException("Unable to update driver availability.");
    }

    return this.loadDashboardSnapshot(session, readDriverLocation(locationInput));
  }

  async acceptJob(session: SessionPayload, jobId: string) {
    this.assertDriver(session);
    const admin = this.supabaseService.createAdminClient();

    const [activeJobResult, jobResult] = await Promise.all([
      admin.schema("driver").from("driver_jobs")
        .select("id", { count: "exact", head: true })
        .eq("driver_id", session.userId)
        .eq("status", "in-progress"),
      admin.schema("driver").from("driver_jobs")
        .select("*")
        .eq("id", jobId)
        .maybeSingle<DriverJobRow>(),
    ]);

    if (activeJobResult.error || jobResult.error) {
      throw new InternalServerErrorException("Unable to accept this job right now.");
    }

    if ((activeJobResult.count ?? 0) > 0) {
      throw new BadRequestException("Complete your active delivery before accepting a new one.");
    }

    const job = jobResult.data;
    if (!job || job.status !== "available") {
      throw new NotFoundException("This delivery job is no longer available.");
    }

    throw new BadRequestException(
      "Job acceptance is only available in the PakiShip mobile app.",
    );
  }

  async updateParcelStatus(
    session: SessionPayload,
    jobId: string,
    parcelStatus: string,
    locationInput?: Record<string, unknown>,
  ) {
    this.assertDriver(session);

    if (!VALID_PARCEL_STATUSES.has(parcelStatus as Exclude<ParcelStatus, null>)) {
      throw new BadRequestException("Invalid parcel status.");
    }

    const admin = this.supabaseService.createAdminClient();
    const jobResult = await admin.schema("driver").from("driver_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("driver_id", session.userId)
      .maybeSingle<DriverJobRow>();

    if (jobResult.error) {
      throw new InternalServerErrorException("Unable to update parcel status.");
    }

    const job = jobResult.data;
    if (!job) {
      throw new NotFoundException("Driver job not found.");
    }

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
      status: parcelStatus === "delivered" ? "completed" : "in-progress",
    };

    const updateResult = await admin.schema("driver").from("driver_jobs")
      .update(updates)
      .eq("id", jobId)
      .eq("driver_id", session.userId);

    if (updateResult.error) {
      throw new InternalServerErrorException("Unable to save the parcel status.");
    }

    let customerNotification:
      | {
          userId: string;
          trackingNumber: string;
        }
      | null = null;

    if (job.parcel_draft_id) {
      const parcelDraftStatus =
        parcelStatus === "picked-up"
          ? "picked_up"
          : parcelStatus === "out-for-delivery"
            ? "out_for_delivery"
            : "delivered";

      const parcelDraftUpdate = await admin.schema("parcel").from("parcel_drafts")
        .update({ status: parcelDraftStatus })
        .eq("id", job.parcel_draft_id)
        .select("user_id, tracking_number")
        .maybeSingle();

      if (parcelDraftUpdate.error) {
        throw new InternalServerErrorException("Parcel status saved, but linked booking could not be updated.");
      }

      if (parcelDraftUpdate.data?.user_id) {
        customerNotification = {
          userId: parcelDraftUpdate.data.user_id,
          trackingNumber:
            parcelDraftUpdate.data.tracking_number || job.job_number,
        };
      }
    }

    if (job.parcel_draft_id) {
      const parcelDraftStatus =
        parcelStatus === "picked-up"
          ? "picked_up"
          : parcelStatus === "out-for-delivery"
            ? "out_for_delivery"
            : "delivered";

      const { error: eventError } = await admin.schema("location").from("parcel_tracking_events").insert({
        id: randomUUID(),
        parcel_draft_id: job.parcel_draft_id,
        status: parcelDraftStatus,
        location_label: getParcelStatusLabel(parcelStatus as Exclude<ParcelStatus, null>),
        occurred_at: now,
      });

      if (eventError) {
        console.warn(
          "[driver-dashboard] parcel status saved but tracking event could not be created",
          eventError.message,
        );
      }
    }

    if (customerNotification) {
      await this.customerNotificationsService.createNotification(
        customerNotification.userId,
        "delivery",
        `Parcel ${getParcelStatusLabel(parcelStatus as Exclude<ParcelStatus, null>)}`,
        getCustomerStatusMessage(
          parcelStatus as Exclude<ParcelStatus, null>,
          customerNotification.trackingNumber,
        ),
      );
    }

    return this.loadDashboardSnapshot(session, readDriverLocation(locationInput));
  }
}
