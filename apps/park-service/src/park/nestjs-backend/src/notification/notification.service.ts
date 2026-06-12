import { Injectable } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';

/**
 * NotificationService — writes to notifications.notifications (snake_case columns).
 * No public schema.
 *
 * Schema: notifications.notifications
 *   id, user_id (UUID), type, title, message, is_read, source_service, created_at
 */
@Injectable()
export class NotificationService {
  constructor(private sequelize: Sequelize) {}

  /** Fire-and-forget insert into notifications.notifications */
  async notify(userId: string, type: string, title: string, message: string, sourceService = 'parking'): Promise<void> {
    try {
      await this.sequelize.query(
        `INSERT INTO notifications.notifications (user_id, type, title, message, source_service, is_read, created_at)
         VALUES (:userId, :type, :title, :message, :sourceService, false, now())`,
        { replacements: { userId, type, title, message, sourceService } },
      );
    } catch (err) { console.warn('[Notification] Write failed (non-fatal):', err.message); }
  }

  notifyBookingConfirmed(userId: string, booking: any) {
    this.notify(userId, 'booking_confirmed', '🎉 Booking Confirmed!',
      `Your slot ${booking.spot} at ${booking.locationName} is reserved for ${booking.date}, ${booking.timeSlot}. Ref: ${booking.reference}`);
  }

  notifyBookingCancelled(userId: string, booking: any, reason?: string) {
    this.notify(userId, 'booking_cancelled', '❌ Booking Cancelled',
      `Booking ${booking.reference} for ${booking.date} ${booking.timeSlot} was cancelled.${reason ? ` Reason: ${reason}` : ''}`);
  }

  notifyBookingReminder(userId: string, booking: any) {
    this.notify(userId, 'booking_reminder', '⏰ Parking Reminder',
      `Your slot ${booking.spot} at ${booking.locationName} starts in 30 min (${booking.timeSlot}). Ref: ${booking.reference}`);
  }

  notifyNoShow(userId: string, booking: any) {
    this.notify(userId, 'no_show', '⚠️ Reservation Forfeited',
      `Booking ${booking.reference} for ${booking.date} ${booking.timeSlot} was auto-cancelled — no check-in within 15 min grace period.`);
  }

  notifyDiscountApproved(userId: string) {
    this.notify(userId, 'discount_approved', '🎁 Discount Approved',
      'Your PWD/Senior Citizen discount is now active — enjoy 20% off every reservation!');
  }

  notifyDiscountRejected(userId: string, reason?: string) {
    this.notify(userId, 'discount_rejected', '❌ Discount Rejected',
      `Your discount request was not approved. ${reason || 'Please upload a valid PWD or Senior Citizen ID.'}`);
  }

  notifySystem(userId: string, title: string, message: string) {
    this.notify(userId, 'system', title, message);
  }
}
