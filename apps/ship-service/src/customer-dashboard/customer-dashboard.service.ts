import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import type { SessionPayload } from "../common/session/session.types";
import { SupabaseService } from "../supabase/supabase.service";
import { CustomerNotificationsService } from "../customer-notifications/customer-notifications.service";

type PreferencePatch = {
  emailNotifications?: boolean;
  smsUpdates?: boolean;
  autoExtend?: boolean;
};

type ReviewInput = {
  trackingNumber: string;
  rating: number;
  review?: string;
  tags?: string[];
};

function ensureCustomer(session: SessionPayload) {
  if (session.role !== "customer") {
    throw new ForbiddenException("Only customers can access this resource.");
  }
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function parseBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function parsePreferences(raw: unknown) {
  const source = (raw ?? {}) as PreferencePatch;
  return {
    emailNotifications: parseBoolean(source.emailNotifications),
    smsUpdates: parseBoolean(source.smsUpdates),
    autoExtend: parseBoolean(source.autoExtend),
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const ACTIVE_DELIVERY_STATUSES = [
  "submitted",
  "picked_up",
  "out_for_delivery",
] as const;

function getDeliveryStatusLabel(status: string) {
  if (status === "picked_up") return "Picked Up";
  if (status === "out_for_delivery") return "Out for Delivery";
  if (status === "delivered") return "Delivered";
  return "In Transit";
}

function formatRelativeTime(value?: string | null) {
  if (!value) return "Just now";

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Just now";

  const diffMs = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;

  if (diffMs < hour) {
    const mins = Math.max(1, Math.floor(diffMs / minute));
    return `${mins} min${mins === 1 ? "" : "s"} ago`;
  }

  const hours = Math.max(1, Math.floor(diffMs / hour));
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

function normalizeTags(input: unknown) {
  const tags = Array.isArray(input) ? input : [];
  return tags
    .map((tag) => asString(tag))
    .filter((tag) => tag.length > 0)
    .slice(0, 10);
}

@Injectable()
export class CustomerDashboardService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly customerNotificationsService: CustomerNotificationsService,
  ) {}

  async getActiveDeliveries(session: SessionPayload, query: { search?: unknown; status?: unknown }) {
    ensureCustomer(session);

    const search = asString(query.search).toLowerCase();
    const statusFilter = asString(query.status).toLowerCase();
    let data:
      | Array<{
          id: string;
          tracking_number: string | null;
          pickup_address: string | null;
          delivery_address: string | null;
          status: string;
        }>
      | null = null;

    try {
      const admin = this.supabaseService.createAdminClient();
      const result = await admin.schema("parcel").from("parcel_drafts")
        .select("id, tracking_number, pickup_address, delivery_address, status")
        .eq("user_id", session.userId)
        .in("status", [...ACTIVE_DELIVERY_STATUSES])
        .order("tracking_number", { ascending: false })
        .limit(100);

      if (result.error) {
        console.error("[customer-dashboard] active deliveries query failed:", result.error.message);
      } else {
        data = result.data;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[customer-dashboard] active deliveries failed:", message);
    }

    const deliveries = (data ?? []).map((item) => ({
      id: item.tracking_number || item.id,
      trackingNumber: item.tracking_number || item.id,
      from: item.pickup_address || "Unknown origin",
      to: item.delivery_address || "Unknown destination",
      status: getDeliveryStatusLabel(item.status),
      rawStatus: item.status,
      updatedAt: null,
      timeLabel: "Recently updated",
    }));

    const filtered = deliveries.filter((item) => {
      const normalizedStatus = item.status.toLowerCase().replace(/\s+/g, "");
      const matchesStatus = !statusFilter || statusFilter === "all" || normalizedStatus === statusFilter;
      const haystack = `${item.trackingNumber} ${item.from} ${item.to}`.toLowerCase();
      const matchesSearch = !search || haystack.includes(search);
      return matchesStatus && matchesSearch;
    });

    return {
      deliveries: filtered,
      summary: {
        totalActive: filtered.length,
        inTransit: filtered.filter((item) => item.rawStatus !== "out_for_delivery").length,
        outForDelivery: filtered.filter((item) => item.rawStatus === "out_for_delivery").length,
      },
    };
  }

  async getAnnouncements(session: SessionPayload) {
    ensureCustomer(session);

    const admin = this.supabaseService.createAdminClient();
    const nowTs = Date.now();
    const { data, error } = await admin.schema("notifications").from("announcements")
      .select("id, target_role, title, message, expires_at, created_at")
      .in("target_role", ["all", "customer"])
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      return {
        announcements: [
          {
            id: "maint-001",
            type: "system",
            title: "Scheduled Maintenance",
            message: "System will be offline on March 15, 2:00 AM - 4:00 AM PHT.",
            isPinned: true,
          },
        ],
      };
    }

    return {
      announcements: (data ?? [])
        .filter((item) => {
          const endsAt = item.expires_at ? new Date(item.expires_at).getTime() : null;
          return endsAt === null || (!Number.isNaN(endsAt) && endsAt >= nowTs);
        })
        .map((item) => ({
          id: item.id,
          type: "system",
          title: item.title,
          message: item.message,
          isPinned: false,
        })),
    };
  }

  async submitReview(session: SessionPayload, input: ReviewInput) {
    ensureCustomer(session);

    const trackingNumber = asString(input.trackingNumber);
    const rating = Number(input.rating);
    const review = asString(input.review);
    const tags = normalizeTags(input.tags);

    if (!trackingNumber) {
      throw new BadRequestException("Tracking number is required.");
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException("Rating must be between 1 and 5.");
    }

    if (review.length > 500) {
      throw new BadRequestException("Review must be 500 characters or less.");
    }

    const admin = this.supabaseService.createAdminClient();
    const ownedBooking = await admin.schema("parcel").from("parcel_drafts")
      .select("id")
      .eq("user_id", session.userId)
      .eq("tracking_number", trackingNumber)
      .eq("status", "submitted")
      .maybeSingle();

    if (ownedBooking.error || !ownedBooking.data) {
      throw new BadRequestException("Tracking number not found in your completed bookings.");
    }

    const insertResult = await admin.schema("parcel").from("parcel_reviews")
      .insert({
        parcel_draft_id: ownedBooking.data.id,
        reviewer_id: session.userId,
        rating,
        review_text: review || null,
        tags,
      })
      .select("id, parcel_draft_id, rating, review_text, tags, created_at")
      .single();

    if (insertResult.error || !insertResult.data) {
      throw new InternalServerErrorException("Unable to submit your review right now.");
    }

    await this.customerNotificationsService.createNotification(
      session.userId,
      "system",
      "Thanks for your feedback",
      `Your review for ${trackingNumber} has been saved.`,
    );

    return {
      review: {
        id: insertResult.data.id,
        trackingNumber,
        rating: insertResult.data.rating,
        review: insertResult.data.review_text,
        tags: insertResult.data.tags ?? [],
        createdAt: insertResult.data.created_at,
      },
    };
  }

  async getRecentReviews(session: SessionPayload, limitInput?: unknown) {
    ensureCustomer(session);

    const limit = Math.min(Math.max(Number(limitInput) || 5, 1), 20);
    const admin = this.supabaseService.createAdminClient();
    const result = await admin.schema("parcel").from("parcel_reviews")
      .select("id, parcel_draft_id, rating, review_text, tags, created_at")
      .eq("reviewer_id", session.userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (result.error) {
      return { reviews: [] };
    }

    return {
      reviews: (result.data ?? []).map((item) => ({
        id: item.id,
        trackingNumber: item.parcel_draft_id,
        rating: item.rating,
        review: item.review_text,
        tags: item.tags ?? [],
        createdAt: item.created_at,
      })),
    };
  }

  async getPreferences(session: SessionPayload) {
    ensureCustomer(session);

    const admin = this.supabaseService.createAdminClient();
    const [{ data: profile, error }, authUser] = await Promise.all([
      admin
        .schema("account")
        .from("profiles")
        .select("notification_preferences")
        .eq("id", session.userId)
        .single(),
      admin.auth.admin.getUserById(session.userId),
    ]);

    if (error || !profile) {
      throw new InternalServerErrorException("Unable to load preferences right now.");
    }

    const metadata = authUser.data.user?.user_metadata ?? {};
    const rawPreferences = isObjectRecord(profile.notification_preferences)
      ? profile.notification_preferences
      : metadata.preferences;

    return {
      preferences: parsePreferences(rawPreferences),
    };
  }

  async updatePreferences(session: SessionPayload, patch: PreferencePatch) {
    ensureCustomer(session);

    const admin = this.supabaseService.createAdminClient();
    const [{ data: profile, error }, authUser] = await Promise.all([
      admin
        .schema("account")
        .from("profiles")
        .select("notification_preferences")
        .eq("id", session.userId)
        .single(),
      admin.auth.admin.getUserById(session.userId),
    ]);

    if (error || !profile) {
      throw new InternalServerErrorException("Unable to load preferences right now.");
    }

    const metadata = authUser.data.user?.user_metadata ?? {};
    const rawPreferences = isObjectRecord(profile.notification_preferences)
      ? profile.notification_preferences
      : metadata.preferences;
    const current = parsePreferences(rawPreferences);

    const preferences = {
      ...current,
      ...(typeof patch.emailNotifications === "boolean"
        ? { emailNotifications: patch.emailNotifications }
        : {}),
      ...(typeof patch.smsUpdates === "boolean" ? { smsUpdates: patch.smsUpdates } : {}),
      ...(typeof patch.autoExtend === "boolean" ? { autoExtend: patch.autoExtend } : {}),
    };

    const profileUpdate = await admin
      .schema("account")
      .from("profiles")
      .update({ notification_preferences: preferences })
      .eq("id", session.userId);

    if (profileUpdate.error) {
      throw new InternalServerErrorException("Unable to save preferences right now.");
    }

    const updateResult = await admin.auth.admin.updateUserById(session.userId, {
      user_metadata: {
        ...metadata,
        preferences,
      },
    });

    if (updateResult.error) {
      throw new InternalServerErrorException("Unable to save preferences right now.");
    }

    return { preferences };
  }
}
