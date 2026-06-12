import { Injectable } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";
import type { UserNotification } from "./notifications.types";

type NotificationRow = {
  id: string;
  user_id: string;
  type: "delivery" | "system" | "promo";
  title: string;
  message: string;
  is_read: boolean | null;
  created_at: string | null;
};

@Injectable()
export class NotificationsRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  async listByUserId(userId: string) {
    const supabase = this.supabaseService.createAdminClient();
    const result = await supabase.schema("notifications").from("notifications")
      .select("id, user_id, type, title, message, is_read, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    return {
      data: (result.data ?? []).map((row) => this.mapRow(row as NotificationRow)),
      error: result.error,
    };
  }

  async create(input: {
    userId: string;
    type: "delivery" | "system" | "promo";
    title: string;
    message: string;
  }) {
    const supabase = this.supabaseService.createAdminClient();
    const result = await supabase.schema("notifications").from("notifications")
      .insert({
        user_id: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        source_service: "pakiship",
      })
      .select("id, user_id, type, title, message, is_read, created_at")
      .single();

    return {
      data: result.data ? this.mapRow(result.data as NotificationRow) : null,
      error: result.error,
    };
  }

  async markOneAsRead(userId: string, notificationId: string) {
    const supabase = this.supabaseService.createAdminClient();
    const result = await supabase.schema("notifications").from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("id", notificationId)
      .select("id, user_id, type, title, message, is_read, created_at")
      .maybeSingle();

    return {
      data: result.data ? this.mapRow(result.data as NotificationRow) : null,
      error: result.error,
    };
  }

  async markAllAsRead(userId: string) {
    const supabase = this.supabaseService.createAdminClient();
    const result = await supabase.schema("notifications").from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false)
      .select("id");

    return {
      count: result.data?.length ?? 0,
      error: result.error,
    };
  }

  async deleteOne(userId: string, notificationId: string) {
    const supabase = this.supabaseService.createAdminClient();
    const result = await supabase.schema("notifications").from("notifications")
      .delete()
      .eq("user_id", userId)
      .eq("id", notificationId)
      .select("id")
      .maybeSingle();

    return {
      data: result.data,
      error: result.error,
    };
  }

  async deleteAll(userId: string) {
    const supabase = this.supabaseService.createAdminClient();
    const result = await supabase.schema("notifications").from("notifications")
      .delete()
      .eq("user_id", userId)
      .select("id");

    return {
      count: result.data?.length ?? 0,
      error: result.error,
    };
  }

  mapRow(row: NotificationRow): UserNotification {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      title: row.title,
      message: row.message,
      isRead: Boolean(row.is_read),
      createdAt: row.created_at,
    };
  }
}
