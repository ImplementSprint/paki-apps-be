import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { SupabaseService } from "../supabase/supabase.service";
import {
  DEFAULT_ITEMS_PAGE_SIZE,
  MAX_ITEMS_PAGE_SIZE,
} from "./parcel-drafts.constants";

const PARCEL_DRAFT_COLUMNS = new Set([
  "id",
  "user_id",
  "tracking_number",
  "pickup_address",
  "delivery_address",
  "sender_name",
  "sender_phone",
  "receiver_name",
  "receiver_phone",
  "service_id",
  "service_price",
  "delivery_mode",
  "assigned_driver_id",
  "status",
  "drop_off_point_id",
  "drop_off_point_name",
  "drop_off_point_address",
  "drop_off_point_distance_text",
  "drop_off_point_status",
  "drop_off_point_capacity",
]);

function createTrackingNumber() {
  const date = new Date();
  const ymd = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `PKS-${ymd}-${suffix}`;
}

function toParcelDraftPayload(payload: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => PARCEL_DRAFT_COLUMNS.has(key)),
  );
}

@Injectable()
export class ParcelDraftsRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findOwnedDraftSummary(draftId: string, userId: string) {
    const supabase = this.supabaseService.createAdminClient();
    return supabase.schema("parcel").from("parcel_drafts")
      .select(`
        id,
        user_id,
        status,
        tracking_number,
        pickup_address,
        delivery_address,
        service_id,
        service_price,
        delivery_mode,
        drop_off_point_id
      `)
      .eq("id", draftId)
      .eq("user_id", userId)
      .single();
  }

  async saveStepOneDraft(
    draftId: string | null,
    userId: string,
    payload: Record<string, unknown>,
  ) {
    const supabase = this.supabaseService.createAdminClient();
    const fullPayload = toParcelDraftPayload({
      user_id: userId,
      ...payload,
    });

    if (draftId) {
      return supabase.schema("parcel").from("parcel_drafts")
        .update(fullPayload)
        .eq("id", draftId)
        .eq("user_id", userId)
        .select("id")
        .single();
    }

    return supabase.schema("parcel").from("parcel_drafts")
      .insert({ id: randomUUID(), tracking_number: createTrackingNumber(), ...fullPayload })
      .select("id")
      .single();
  }

  async findOwnedDraftWithItems(
    draftId: string,
    userId: string,
    itemsLimit = DEFAULT_ITEMS_PAGE_SIZE,
  ) {
    const cappedLimit = Math.min(Math.max(itemsLimit, 1), MAX_ITEMS_PAGE_SIZE);
    const supabase = this.supabaseService.createAdminClient();

    const draftResult = await supabase.schema("parcel").from("parcel_drafts")
      .select(
        `
          id,
          pickup_address,
          delivery_address,
          status,
          tracking_number
        `,
      )
      .eq("id", draftId)
      .eq("user_id", userId)
      .single();

    const itemsResult = draftResult.data
      ? await supabase.schema("parcel").from("parcel_draft_items")
          .select("id, size, weight_text, item_type, delivery_guarantee, quantity, photo_url")
          .eq("parcel_draft_id", draftId)
          .order("id", { ascending: true })
          .limit(cappedLimit)
      : { data: [], error: null };

    const countResult = await supabase.schema("parcel").from("parcel_draft_items")
      .select("id", { count: "exact", head: true })
      .eq("parcel_draft_id", draftId);

    return {
      ...draftResult,
      data: draftResult.data
        ? { ...draftResult.data, parcel_draft_items: itemsResult.data ?? [] }
        : draftResult.data,
      error: draftResult.error ?? itemsResult.error,
      itemCount: countResult.count ?? 0,
      itemPageSize: cappedLimit,
    };
  }

  async listOwnedDraftItemsWithCount(
    draftId: string,
    userId: string,
    limit = DEFAULT_ITEMS_PAGE_SIZE,
    offset = 0,
  ) {
    const cappedLimit = Math.min(Math.max(limit, 1), MAX_ITEMS_PAGE_SIZE);
    const safeOffset = Math.max(offset, 0);
    const supabase = this.supabaseService.createAdminClient();

    const { data: draft, error: draftError } = await supabase.schema("parcel").from("parcel_drafts")
      .select("id")
      .eq("id", draftId)
      .eq("user_id", userId)
      .single();

    if (draftError || !draft) {
      return { data: null, error: draftError ?? new Error("Draft not found"), totalCount: 0 };
    }

    const { data, error, count } = await supabase.schema("parcel").from("parcel_draft_items")
      .select(
        "id, size, weight_text, item_type, delivery_guarantee, quantity, photo_url",
        { count: "exact" },
      )
      .eq("parcel_draft_id", draftId)
      .order("id", { ascending: true })
      .range(safeOffset, safeOffset + cappedLimit - 1);

    return { data, error, totalCount: count ?? 0, limit: cappedLimit, offset: safeOffset };
  }

  async findOwnedDraftItem(draftId: string, itemId: string, userId: string) {
    const supabase = this.supabaseService.createAdminClient();
    const draftResult = await supabase.schema("parcel").from("parcel_drafts")
      .select("id")
      .eq("id", draftId)
      .eq("user_id", userId)
      .single();

    if (draftResult.error || !draftResult.data) {
      return { data: null, error: draftResult.error ?? new Error("Draft not found") };
    }

    return supabase.schema("parcel").from("parcel_draft_items")
      .select("id, quantity")
      .eq("id", itemId)
      .eq("parcel_draft_id", draftId)
      .single();
  }

  async createDraftItems(items: Record<string, unknown>[]) {
    const supabase = this.supabaseService.createAdminClient();
    return supabase.schema("parcel").from("parcel_draft_items").insert(items).select("id");
  }

  async updateDraftItemQuantity(draftId: string, itemId: string, quantity: number) {
    const supabase = this.supabaseService.createAdminClient();
    return supabase.schema("parcel").from("parcel_draft_items")
      .update({ quantity })
      .eq("id", itemId)
      .eq("parcel_draft_id", draftId);
  }

  async deleteDraftItem(draftId: string, itemId: string) {
    const supabase = this.supabaseService.createAdminClient();
    return supabase.schema("parcel").from("parcel_draft_items")
      .delete()
      .eq("id", itemId)
      .eq("parcel_draft_id", draftId);
  }

  async updateOwnedDraftState(
    draftId: string,
    userId: string,
    patch: Record<string, unknown>,
  ) {
    const supabase = this.supabaseService.createAdminClient();
    const payload = toParcelDraftPayload(patch);

    if (Object.keys(payload).length === 0) {
      return supabase.schema("parcel").from("parcel_drafts")
        .select("id, status, tracking_number")
        .eq("id", draftId)
        .eq("user_id", userId)
        .single();
    }

    return supabase.schema("parcel").from("parcel_drafts")
      .update(payload)
      .eq("id", draftId)
      .eq("user_id", userId)
      .select("id, status, tracking_number")
      .single();
  }

  async findOwnedSubmittedDraftByTrackingNumber(userId: string, trackingNumber: string) {
    const supabase = this.supabaseService.createAdminClient();
    return supabase.schema("parcel").from("parcel_drafts")
      .select(
        `
          id,
          tracking_number,
          pickup_address,
          delivery_address,
          service_id,
          service_price,
          status,
          sender_name,
          sender_phone,
          receiver_name,
          receiver_phone
        `,
      )
      .eq("user_id", userId)
      .eq("tracking_number", trackingNumber)
      .eq("status", "submitted")
      .single();
  }

  async listOwnedHistory(userId: string) {
    const supabase = this.supabaseService.createAdminClient();
    const draftsResult = await supabase.schema("parcel").from("parcel_drafts")
      .select(
        `
          id,
          tracking_number,
          pickup_address,
          delivery_address,
          service_id,
          service_price,
          status,
          sender_name,
          sender_phone,
          receiver_name,
          receiver_phone
        `,
      )
      .eq("user_id", userId)
      .in("status", ["submitted", "picked_up", "out_for_delivery", "delivered", "cancelled", "lost"])
      .order("tracking_number", { ascending: false });

    if (draftsResult.error || !draftsResult.data?.length) {
      return draftsResult;
    }

    const draftIds = draftsResult.data.map((draft) => draft.id);
    const itemsResult = await supabase.schema("parcel").from("parcel_draft_items")
      .select("id, parcel_draft_id, item_type, delivery_guarantee, quantity, weight_text")
      .in("parcel_draft_id", draftIds);

    if (itemsResult.error) {
      return { ...draftsResult, error: itemsResult.error };
    }

    const itemsByDraftId = new Map<string, unknown[]>();
    for (const item of itemsResult.data ?? []) {
      const key = String(item.parcel_draft_id);
      itemsByDraftId.set(key, [...(itemsByDraftId.get(key) ?? []), item]);
    }

    return {
      ...draftsResult,
      data: draftsResult.data.map((draft) => ({
        ...draft,
        parcel_draft_items: itemsByDraftId.get(draft.id) ?? [],
      })),
    };
  }

  async findOwnedHistoryByTrackingNumber(userId: string, trackingNumber: string) {
    const supabase = this.supabaseService.createAdminClient();
    const draftResult = await supabase.schema("parcel").from("parcel_drafts")
      .select(
        `
          id,
          tracking_number,
          pickup_address,
          delivery_address,
          status,
          sender_name,
          sender_phone,
          receiver_name,
          receiver_phone
        `,
      )
      .eq("user_id", userId)
      .eq("tracking_number", trackingNumber)
      .single();

    if (draftResult.error || !draftResult.data) {
      return draftResult;
    }

    const itemsResult = await supabase.schema("parcel").from("parcel_draft_items")
      .select("id, item_type, delivery_guarantee, quantity, weight_text")
      .eq("parcel_draft_id", draftResult.data.id);

    return {
      ...draftResult,
      data: {
        ...draftResult.data,
        parcel_draft_items: itemsResult.data ?? [],
      },
      error: itemsResult.error ?? null,
    };
  }

  async listRelayBookingsForHub(hubId: string) {
    const supabase = this.supabaseService.createAdminClient();
    const draftsResult = await supabase.schema("parcel").from("parcel_drafts")
      .select(
        `
          id,
          tracking_number,
          pickup_address,
          delivery_address,
          status,
          sender_name,
          sender_phone,
          receiver_name,
          receiver_phone,
          service_id,
          delivery_mode,
          drop_off_point_id
        `,
      )
      .eq("service_id", "pakishare")
      .eq("drop_off_point_id", hubId)
      .in("status", ["draft", "submitted"])
      .order("tracking_number", { ascending: false });

    return this.withDraftItems(draftsResult);
  }

  async listRecentRelayBookings(limit = 10) {
    const supabase = this.supabaseService.createAdminClient();
    const draftsResult = await supabase.schema("parcel").from("parcel_drafts")
      .select(
        `
          id,
          tracking_number,
          pickup_address,
          delivery_address,
          status,
          sender_name,
          sender_phone,
          receiver_name,
          receiver_phone,
          service_id,
          delivery_mode,
          drop_off_point_id
        `,
      )
      .eq("service_id", "pakishare")
      .in("status", ["draft", "submitted"])
      .order("tracking_number", { ascending: false })
      .limit(limit);

    return this.withDraftItems(draftsResult);
  }

  async findRelayBookingById(draftId: string) {
    const supabase = this.supabaseService.createAdminClient();
    return supabase.schema("parcel").from("parcel_drafts")
      .select(
        `
          id,
          user_id,
          tracking_number,
          status,
          service_id,
          delivery_mode,
          drop_off_point_id,
          receiver_name
        `,
      )
      .eq("id", draftId)
      .eq("service_id", "pakishare")
      .maybeSingle();
  }

  async updateRelayBookingTracking(draftId: string, patch: Record<string, unknown>) {
    const supabase = this.supabaseService.createAdminClient();
    return supabase.schema("parcel").from("parcel_drafts")
      .update(toParcelDraftPayload(patch))
      .eq("id", draftId)
      .eq("service_id", "pakishare")
      .select(
        "id, tracking_number, status",
      )
      .single();
  }

  private async withDraftItems<T extends { id: string }>(
    draftsResult: { data: T[] | null; error: unknown },
  ) {
    if (draftsResult.error || !draftsResult.data?.length) {
      return draftsResult;
    }

    const supabase = this.supabaseService.createAdminClient();
    const draftIds = draftsResult.data.map((draft) => draft.id);
    const itemsResult = await supabase.schema("parcel").from("parcel_draft_items")
      .select("id, parcel_draft_id, item_type, quantity, weight_text")
      .in("parcel_draft_id", draftIds);

    if (itemsResult.error) {
      return { ...draftsResult, error: itemsResult.error };
    }

    const itemsByDraftId = new Map<string, unknown[]>();
    for (const item of itemsResult.data ?? []) {
      const key = String(item.parcel_draft_id);
      itemsByDraftId.set(key, [...(itemsByDraftId.get(key) ?? []), item]);
    }

    return {
      ...draftsResult,
      data: draftsResult.data.map((draft) => ({
        ...draft,
        parcel_draft_items: itemsByDraftId.get(draft.id) ?? [],
      })),
    };
  }
}
