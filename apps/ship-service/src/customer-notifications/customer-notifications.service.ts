import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import type { SessionPayload } from "../common/session/session.types";
import { SupabaseService } from "../supabase/supabase.service";

type NotificationType = "delivery" | "system" | "promo";

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

@Injectable()
export class CustomerNotificationsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private ensureCustomer(session: SessionPayload) {
    if (session.role !== "customer") {
      throw new ForbiddenException("Only customers can access notifications.");
    }
  }

  async createNotification(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
  ) {
    const admin = this.supabaseService.createAdminClient();
    const { error } = await admin.schema("notifications").from("notifications").insert({
      user_id: userId,
      type,
      title,
      message,
      is_read: false,
      source_service: "pakiship",
    });

    if (error) {
      throw new InternalServerErrorException("Unable to create customer notification.");
    }
  }

  async listNotifications(session: SessionPayload) {
    this.ensureCustomer(session);
    const admin = this.supabaseService.createAdminClient();
    const { data, error } = await admin.schema("notifications").from("notifications")
      .select("id, type, title, message, is_read, created_at")
      .eq("user_id", session.userId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      throw new InternalServerErrorException("Unable to load notifications.");
    }

    return {
      notifications: (data ?? []).map((item) => ({
        id: item.id,
        type: item.type as NotificationType,
        title: item.title,
        message: item.message,
        time: formatRelativeTime(item.created_at),
        isRead: item.is_read,
        createdAt: item.created_at,
      })),
    };
  }

  async markAsRead(session: SessionPayload, notificationId: string) {
    this.ensureCustomer(session);
    const admin = this.supabaseService.createAdminClient();
    const { error } = await admin.schema("notifications").from("notifications")
      .update({ is_read: true })
      .eq("id", notificationId)
      .eq("user_id", session.userId);

    if (error) {
      throw new InternalServerErrorException("Unable to update notification.");
    }

    return { notificationId };
  }

  async markAllAsRead(session: SessionPayload) {
    this.ensureCustomer(session);
    const admin = this.supabaseService.createAdminClient();
    const { error } = await admin.schema("notifications").from("notifications")
      .update({ is_read: true })
      .eq("user_id", session.userId)
      .eq("is_read", false);

    if (error) {
      throw new InternalServerErrorException("Unable to update notifications.");
    }

    return { success: true };
  }

  async clearAll(session: SessionPayload) {
    this.ensureCustomer(session);
    const admin = this.supabaseService.createAdminClient();
    const { error } = await admin.schema("notifications").from("notifications")
      .delete()
      .eq("user_id", session.userId);

    if (error) {
      throw new InternalServerErrorException("Unable to clear notifications.");
    }

    return { success: true };
  }
}
