import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type { SessionPayload } from "../common/session/session.types";
import { SupabaseService } from "../supabase/supabase.service";

type OwnedParcelRow = {
  id: string;
  tracking_number: string | null;
  status: string | null;
};

type ExistingReviewRow = {
  id: string;
};

type CompletedDriverJobRow = {
  id: string;
  driver_id: string | null;
};

type SubmitFeedbackInput = {
  trackingNumber: string;
  rating: number;
  review?: string;
  tags?: string[];
};

function normalizeTrackingNumber(value: string) {
  return value.trim().toUpperCase();
}

function sanitizeReview(value?: string) {
  const review = value?.trim() ?? "";

  if (review.length > 500) {
    throw new BadRequestException("Review must be 500 characters or fewer.");
  }

  return review.length > 0 ? review : null;
}

function sanitizeTags(value?: string[]) {
  return [...new Set((value ?? [])
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .slice(0, 8))];
}

@Injectable()
export class CustomerFeedbackService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private async findOwnedParcel(userId: string, trackingNumber: string) {
    const admin = this.supabaseService.createAdminClient();
    const { data, error } = await admin.schema("parcel").from("parcel_drafts")
      .select("id, tracking_number, status")
      .eq("user_id", userId)
      .eq("tracking_number", trackingNumber)
      .limit(1)
      .maybeSingle<OwnedParcelRow>();

    if (error) {
      throw new InternalServerErrorException("Unable to validate your parcel feedback.");
    }

    if (!data) {
      throw new NotFoundException("Tracking number not found in your parcel history.");
    }

    return data;
  }

  private async findCompletedDriverJob(draftId: string) {
    const admin = this.supabaseService.createAdminClient();
    const { data, error } = await admin.schema("driver").from("driver_jobs")
      .select("id, driver_id")
      .eq("parcel_draft_id", draftId)
      .eq("status", "completed")
      .not("driver_id", "is", null)
      .limit(1)
      .maybeSingle<CompletedDriverJobRow>();

    if (error) {
      throw new InternalServerErrorException("Unable to validate the completed driver delivery.");
    }

    return data ?? null;
  }

  private async findExistingFeedback(draftId: string, userId: string) {
    const admin = this.supabaseService.createAdminClient();
    const { data, error } = await admin.schema("parcel").from("parcel_reviews")
      .select("id")
      .eq("reviewer_id", userId)
      .eq("parcel_draft_id", draftId)
      .limit(1)
      .maybeSingle<ExistingReviewRow>();

    if (error) {
      throw new InternalServerErrorException("Unable to validate existing parcel feedback.");
    }

    return data ?? null;
  }

  async getMyReviews(session: SessionPayload) {
    if (session.role !== "customer") {
      throw new ForbiddenException("Only customers can access their parcel feedback.");
    }

    const admin = this.supabaseService.createAdminClient();
    const { data, error } = await admin.schema("parcel").from("parcel_reviews")
      .select("id, parcel_draft_id, rating, review_text, tags, created_at")
      .eq("reviewer_id", session.userId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      throw new InternalServerErrorException("Unable to retrieve your parcel feedback.");
    }

    return (data ?? []).map((row) => ({
      reviewId: row.id as string,
      trackingNumber: row.parcel_draft_id as string,
      rating: row.rating as number,
      review: row.review_text as string | null,
      tags: row.tags as string[],
      createdAt: row.created_at as string,
      updatedAt: row.created_at as string,
    }));
  }

  async submitFeedback(session: SessionPayload, input: SubmitFeedbackInput) {
    if (session.role !== "customer") {
      throw new ForbiddenException("Only customers can submit parcel feedback.");
    }

    const trackingNumber = normalizeTrackingNumber(input.trackingNumber);
    if (!trackingNumber) {
      throw new BadRequestException("Tracking number is required.");
    }

    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new BadRequestException("Rating must be a whole number from 1 to 5.");
    }

    const review = sanitizeReview(input.review);
    const tags = sanitizeTags(input.tags);
    const ownedParcel = await this.findOwnedParcel(session.userId, trackingNumber);
    const completedDriverJob = await this.findCompletedDriverJob(ownedParcel.id);
    if (!completedDriverJob) {
      throw new BadRequestException("You can rate your driver after the delivery is completed.");
    }

    const existingFeedback = await this.findExistingFeedback(ownedParcel.id, session.userId);
    const admin = this.supabaseService.createAdminClient();
    const timestamp = new Date().toISOString();
    const payload = {
      parcel_draft_id: ownedParcel.id,
      reviewer_id: session.userId,
      rating: input.rating,
      review_text: review,
      tags,
    };

    const result = existingFeedback
      ? await admin.schema("parcel").from("parcel_reviews")
          .update(payload)
          .eq("id", existingFeedback.id)
          .select("id")
          .single()
      : await admin.schema("parcel").from("parcel_reviews")
          .insert({
            ...payload,
            created_at: timestamp,
          })
          .select("id")
          .single();

    if (result.error || !result.data) {
      throw new InternalServerErrorException("Unable to submit parcel feedback right now.");
    }

    return {
      message: existingFeedback ? "Feedback updated successfully." : "Feedback submitted successfully.",
      reviewId: result.data.id,
      trackingNumber,
      rating: input.rating,
      review,
      tags,
    };
  }
}
