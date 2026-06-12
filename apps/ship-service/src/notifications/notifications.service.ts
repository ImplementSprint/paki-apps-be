import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type { SessionPayload } from "../common/session/session.types";
import { NotificationsRepository } from "./notifications.repository";

const ALLOWED_NOTIFICATION_TYPES = new Set(["delivery", "system", "promo"]);

@Injectable()
export class NotificationsService {
  constructor(private readonly notificationsRepository: NotificationsRepository) {}

  async listForUser(session: SessionPayload) {
    const result = await this.notificationsRepository.listByUserId(session.userId);
    if (result.error) {
      throw new InternalServerErrorException("Unable to load notifications.");
    }

    return {
      notifications: result.data ?? [],
      unreadCount: (result.data ?? []).filter((item) => !item.isRead).length,
    };
  }

  async createForUser(session: SessionPayload, body: Record<string, unknown>) {
    const type = String(body.type ?? "");
    const title = String(body.title ?? "").trim();
    const message = String(body.message ?? "").trim();

    if (!ALLOWED_NOTIFICATION_TYPES.has(type)) {
      throw new BadRequestException("Notification type is invalid.");
    }

    if (!title || !message) {
      throw new BadRequestException("Notification title and message are required.");
    }

    const result = await this.notificationsRepository.create({
      userId: session.userId,
      type: type as "delivery" | "system" | "promo",
      title,
      message,
    });

    if (result.error || !result.data) {
      throw new InternalServerErrorException("Unable to create notification.");
    }

    return {
      notification: result.data,
      message: "Notification created successfully.",
    };
  }

  async markAsRead(session: SessionPayload, notificationId: string) {
    const result = await this.notificationsRepository.markOneAsRead(
      session.userId,
      notificationId,
    );

    if (result.error) {
      throw new InternalServerErrorException("Unable to update notification.");
    }

    if (!result.data) {
      throw new NotFoundException("Notification not found.");
    }

    return {
      notification: result.data,
      message: "Notification marked as read.",
    };
  }

  async markAllAsRead(session: SessionPayload) {
    const result = await this.notificationsRepository.markAllAsRead(session.userId);
    if (result.error) {
      throw new InternalServerErrorException("Unable to mark notifications as read.");
    }

    return {
      updatedCount: result.count ?? 0,
      message: "All notifications marked as read.",
    };
  }

  async deleteOne(session: SessionPayload, notificationId: string) {
    const result = await this.notificationsRepository.deleteOne(session.userId, notificationId);
    if (result.error) {
      throw new InternalServerErrorException("Unable to delete notification.");
    }

    if (!result.data) {
      throw new NotFoundException("Notification not found.");
    }

    return {
      deleted: true,
      notificationId,
    };
  }

  async clearAll(session: SessionPayload) {
    const result = await this.notificationsRepository.deleteAll(session.userId);
    if (result.error) {
      throw new InternalServerErrorException("Unable to clear notifications.");
    }

    return {
      deletedCount: result.count ?? 0,
      message: "All notifications cleared.",
    };
  }
}
