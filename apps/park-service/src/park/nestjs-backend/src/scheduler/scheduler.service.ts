import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { BookingModel } from '../models/booking.model';
import { NotificationService } from '../notification/notification.service';
import { LogService } from '../logs/log.service';
import { formatBooking } from '../common/formatters';
import { SmsService } from '../sms/sms.service';
import { EmailService } from '../email/email.service';

const GRACE_PERIOD_MIN = 15;

function slotStartDate(dateStr: string, timeSlot: string): Date | null {
  const match = String(timeSlot).match(/(\d{1,2}):(\d{2})\s*[-–]/);
  if (!match) return null;
  const [, hh, mm] = match;
  const d = new Date(`${dateStr}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * SchedulerService — uses reservation.bookings (ORM) + parking_lot.locations (raw SQL).
 * No public schema. userId is always a UUID string.
 * Tracks reminders in-memory to prevent schema mismatch with missing DB columns.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private sentReminders = new Set<string>(); // Transient in-memory reminder tracker
  private sentOvertimeWarnings = new Set<string>();
  private sentOvertimeCharges = new Set<string>();

  constructor(
    @InjectModel(BookingModel) private bookingModel: typeof BookingModel,
    private sequelize: Sequelize,
    private notifSvc: NotificationService,
    private logSvc:   LogService,
    private smsSvc:   SmsService,
    private emailSvc: EmailService,
  ) {}

  onModuleInit() {
    console.log(`[Forfeiture] 🕐 Scheduler started — grace: ${GRACE_PERIOD_MIN} min, sweep: every 60s`);
    this.runForfeitureSweep();
    this.runReminderSweep();
    this.runOvertimeSweep();
    this.timer = setInterval(() => {
      this.runForfeitureSweep();
      this.runReminderSweep();
      this.runOvertimeSweep();
    }, 60 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runForfeitureSweep(): Promise<void> {
    try {
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      const candidates = await this.bookingModel.findAll({
        where: { status: 'upcoming', date: todayStr, checkInAt: null },
        raw: true,
      });
      if (!candidates.length) return;

      const toForfeit = candidates.filter((b) => {
        const start = slotStartDate((b as any).date, (b as any).timeSlot);
        return start && start.getTime() + GRACE_PERIOD_MIN * 60_000 < now.getTime();
      });
      if (!toForfeit.length) return;

      const ids = toForfeit.map((b) => (b as any).id);
      await this.bookingModel.update(
        { status: 'cancelled' } as any,
        { where: { id: { [Op.in]: ids } } },
      );

      // Restore available_spots in parking_lot.locations — no public schema
      const perLocation: Record<string, number> = {};
      const slotIdsToRestore: string[] = [];
      toForfeit.forEach((b) => {
        const lid = (b as any).locationId;
        if (lid) perLocation[String(lid)] = (perLocation[String(lid)] || 0) + 1;
        const sid = (b as any).parkingSlotId;
        if (sid) slotIdsToRestore.push(String(sid));
      });
      await Promise.all([
        ...Object.entries(perLocation).map(([locId, count]) =>
          this.sequelize.query(
            `UPDATE parking_lot.locations SET available_spots = available_spots + :count WHERE id = :id`,
            { replacements: { count, id: locId } },
          )
        ),
        slotIdsToRestore.length > 0
          ? this.sequelize.query(
              `UPDATE parking_lot.parking_slots SET status = 'available' WHERE id IN (:slotIds)`,
              { replacements: { slotIds: slotIdsToRestore } },
            )
          : Promise.resolve(),
      ]);

      // Notify & log
      for (const b of toForfeit) {
        try {
          const fmt = formatBooking(b);
          this.logSvc.logBookingNoShow({ booking: fmt, adminId: null });
          this.notifSvc.notifyNoShow(String((b as any).userId), { ...fmt, id: (b as any).id });
        } catch { /* never crash scheduler */ }
      }

      console.log(`[Forfeiture] ⏰ Auto-forfeited ${toForfeit.length} no-show(s): [${toForfeit.map((b) => (b as any).reference || (b as any).id).join(', ')}]`);
    } catch (err: any) {
      console.error('[Forfeiture] ❌ Sweep error:', err.message);
    }
  }

  async runReminderSweep(): Promise<void> {
    try {
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const nowMs = now.getTime();

      const candidates = await this.bookingModel.findAll({
        where: { status: 'upcoming', date: todayStr, checkInAt: null },
        raw: true,
      });

      for (const b of candidates) {
        const id = (b as any).id;
        if (this.sentReminders.has(id)) continue;

        const start = slotStartDate((b as any).date, (b as any).timeSlot);
        if (!start) continue;
        const minsUntil = (start.getTime() - nowMs) / 60_000;
        if (minsUntil > 0 && minsUntil <= 30) {
          this.sentReminders.add(id);
          const fmt = formatBooking(b);
          this.notifSvc.notifyBookingReminder(String((b as any).userId), { ...fmt, id });
          console.log(`[Reminder] 🔔 30-min reminder → booking ${(b as any).reference} (user ${(b as any).userId})`);
        }
      }
    } catch (err: any) {
      console.error('[Reminder] ❌ Sweep error:', err.message);
    }
  }

  async runOvertimeSweep(): Promise<void> {
    try {
      const candidates = await this.bookingModel.findAll({
        where: { status: 'active' }, // only active (checked in, not completed)
        raw: true,
      });

      const nowMs = Date.now();
      const BASE_TIME_MINS = 120; // 2 hours

      for (const b of candidates) {
        const id = (b as any).id;
        const checkInAt = (b as any).checkInAt;
        if (!checkInAt) continue;
        
        const minsElapsed = (nowMs - new Date(checkInAt).getTime()) / 60_000;
        
        // 1. 15 mins before overtime (105 mins elapsed)
        if (minsElapsed >= (BASE_TIME_MINS - 15) && minsElapsed < BASE_TIME_MINS && !this.sentOvertimeWarnings.has(id)) {
          this.sentOvertimeWarnings.add(id);
          const userId = String((b as any).userId);
          const spot = (b as any).spot;
          
          const msg = `⏳ Your 2-hour base parking time for spot ${spot} will expire in 15 minutes. Overtime rate of ₱15/hour will apply soon.`;
          this.notifSvc.notifySystem(userId, 'Nearing Overtime', msg);
          
          // Send SMS/Email
          const [[user]] = await this.sequelize.query(`SELECT email, phone FROM account.profiles WHERE id = :userId LIMIT 1`, { replacements: { userId } }) as any;
          if (user) {
            if (user.phone) this.smsSvc.sendSms(user.phone, msg).catch(() => {});
            if (user.email && !user.email.includes('@phone.pakipark.local')) {
              this.emailSvc.sendEmail(user.email, 'PakiPark - Nearing Overtime', `<p>${msg}</p>`).catch(() => {});
            }
          }
          console.log(`[Overtime] ⏳ 15-min warning → booking ${(b as any).reference} (user ${userId})`);
        }

        // 2. Overtime started (120+ mins elapsed)
        if (minsElapsed >= BASE_TIME_MINS && !this.sentOvertimeCharges.has(id)) {
          this.sentOvertimeCharges.add(id);
          const userId = String((b as any).userId);
          const spot = (b as any).spot;
          
          const msg = `💸 You have consumed your 2-hour base parking time for spot ${spot}. You will now be charged ₱15 for every succeeding hour.`;
          this.notifSvc.notifySystem(userId, 'Overtime Started', msg);
          
          // Send SMS/Email
          const [[user]] = await this.sequelize.query(`SELECT email, phone FROM account.profiles WHERE id = :userId LIMIT 1`, { replacements: { userId } }) as any;
          if (user) {
            if (user.phone) this.smsSvc.sendSms(user.phone, msg).catch(() => {});
            if (user.email && !user.email.includes('@phone.pakipark.local')) {
              this.emailSvc.sendEmail(user.email, 'PakiPark - Overtime Started', `<p>${msg}</p>`).catch(() => {});
            }
          }
          console.log(`[Overtime] 💸 Charge started → booking ${(b as any).reference} (user ${userId})`);
        }
      }
    } catch (err: any) {
      console.error('[Overtime] ❌ Sweep error:', err.message);
    }
  }
}
