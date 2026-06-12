import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { BookingModel } from '../models/booking.model';
import { LocationModel } from '../models/location.model';
import { VehicleModel } from '../models/vehicle.model';
import { formatBooking } from '../common/formatters';
import { computeRefundPolicy, windowsOverlap, computeTimingMeta } from '../common/time.utils';
import { NotificationService } from '../notification/notification.service';
import { LogService } from '../logs/log.service';
import { PaymentService } from '../payment/payment.service';
import { EmailService } from '../email/email.service';

/**
 * BookingService — all user identity via account.profiles (UUID string).
 * No public schema references.
 *
 * Schemas:
 *   reservation.bookings       → BookingModel (UUID PK)
 *   parking_lot.locations      → LocationModel (UUID PK)
 *   teller.vehicles            → VehicleModel (UUID PK)
 *   account.profiles           → raw SQL for user snapshot (UUID PK)
 */
@Injectable()
export class BookingService {
  constructor(
    @InjectModel(BookingModel)  private bookingModel:  typeof BookingModel,
    @InjectModel(LocationModel) private locationModel: typeof LocationModel,
    @InjectModel(VehicleModel)  private vehicleModel:  typeof VehicleModel,
    private notifSvc:  NotificationService,
    private logSvc:    LogService,
    private paymentSvc: PaymentService,
    private emailSvc:  EmailService,
    private sequelize: Sequelize,
  ) {}

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Fetch user snapshot from account.profiles (UUID PK, snake_case columns) */
  private async getUserSnapshot(authId: string): Promise<any> {
    const [rows]: [any[], unknown] = await this.sequelize.query(
      `SELECT id, full_name, email, phone,
              notification_preferences->>'discountStatus' AS discount_status,
              (notification_preferences->>'discountPct')::int AS discount_pct
       FROM account.profiles WHERE id = :authId LIMIT 1`,
      { replacements: { authId } },
    );
    return rows[0] || null;
  }

  private calcAmount(timeSlot: string, baseRate: number, discountFraction: number): number {
    const parts = String(timeSlot).split('-');
    const [h1, m1] = (parts[0] || '0:0').trim().split(':').map(Number);
    const [h2, m2] = (parts[1] || `${h1 + 1}:0`).trim().split(':').map(Number);
    const durationHrs = ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60 || 1;
    const raw = Math.round(baseRate * durationHrs * 100) / 100;
    return Math.round(raw * (1 - discountFraction) * 100) / 100;
  }

  // ── Public Methods ────────────────────────────────────────────────────────

  async createBooking(authId: string, data: any): Promise<any> {
    const { vehicleId, locationId, spot, date, timeSlot, paymentMethod } = data;
    if (!vehicleId || !locationId || !spot || !date || !timeSlot || !paymentMethod)
      throw new Error('vehicleId, locationId, spot, date, timeSlot, paymentMethod are required');

    const [user, vehicle, location] = await Promise.all([
      this.getUserSnapshot(authId),
      this.vehicleModel.findOne({ where: { id: vehicleId } }),
      this.locationModel.findByPk(locationId),
    ]);

    if (!vehicle)  throw new Error('Vehicle not found');
    if (!location) throw new Error('Location not found');
    if (!location.isActive) throw new Error('This parking location is not currently active');
    if ((location.availableSpots || 0) <= 0) throw new Error('No available spots at this location');

    // Resolve Slot and check conflicts
    let assignedSpot = spot;
    let assignedSlotId = null;

    if (spot === 'Auto-Assigned') {
      // Find an available physical slot at this location
      const [allSlots]: [any[], unknown] = await this.sequelize.query(
        `SELECT id, label, floor FROM parking_lot.parking_slots WHERE location_id = :locationId AND status = 'available' ORDER BY floor ASC, label ASC`,
        { replacements: { locationId: String(locationId) } }
      );

      for (const slot of allSlots) {
        const conflict = await this.bookingModel.findOne({
          where: {
            locationId: String(locationId),
            spot: slot.label,
            status: { [Op.in]: ['upcoming', 'active'] },
            date: String(date)
          }
        });
        if (!conflict || !windowsOverlap(conflict.timeSlot, timeSlot)) {
          assignedSpot = slot.label;
          assignedSlotId = slot.id;
          break;
        }
      }
      
      // Fallback if no specific available slot is found
      if (assignedSpot === 'Auto-Assigned' && allSlots.length > 0) {
        assignedSpot = allSlots[0].label;
        assignedSlotId = allSlots[0].id;
      }
    } else {
      // If a specific spot is selected, validate conflict
      const conflict = await this.bookingModel.findOne({
        where: { locationId: String(locationId), spot: String(spot), status: { [Op.in]: ['upcoming', 'active'] }, date: String(date) },
      });
      if (conflict && windowsOverlap(conflict.timeSlot, timeSlot))
        throw new Error('This parking spot is already booked for the selected time slot');

      // Fetch its parkingSlotId
      const [physicalSlots]: [any[], unknown] = await this.sequelize.query(
        `SELECT id FROM parking_lot.parking_slots WHERE location_id = :locationId AND label = :label LIMIT 1`,
        { replacements: { locationId: String(locationId), label: String(spot) } }
      );
      if (physicalSlots && physicalSlots.length > 0) {
        assignedSlotId = physicalSlots[0].id;
      }
    }

    // Discount from notification_preferences JSONB
    const discountStatus = user?.discount_status;
    const discountFraction = discountStatus === 'approved' ? ((user?.discount_pct || 20) / 100) : 0;
    const baseRate = (location as any).pricePerHour || 50;
    const amount = this.calcAmount(timeSlot, baseRate, discountFraction);

    const bookingData: any = {
      userId:         authId,
      vehicleId:      vehicleId,
      locationId:     String(locationId),
      parkingSlotId:  assignedSlotId,
      spot:           assignedSpot,
      date:           String(date),
      timeSlot:       String(timeSlot),
      paymentMethod,
      amount,
      paymentStatus:  'pending',
      status:         'upcoming',
      // Snapshot fields (confirmed in reservation.bookings)
      vehiclePlate:    vehicle.plateNumber || null,
      vehicleType:     vehicle.type || null,
      vehicleColor:    vehicle.color || null,
      locationName:    location.name || null,
      locationAddress: location.address || null,
    };

    const booking = await this.bookingModel.create(bookingData);

    // Payment gateway
    let checkoutUrl: string | null = null;
    if (['GCash', 'PayMaya', 'Credit/Debit Card'].includes(paymentMethod)) {
      try {
        const session = await this.paymentSvc.createCheckoutSession({
          amount,
          referenceId: booking.reference,
          description: `PakiPark slot ${spot} at ${location.name}`,
          method: paymentMethod,
        });
        await booking.update({ paymentSessionId: session.sessionId, paymentStatus: 'pending' });
        checkoutUrl = session.checkoutUrl;
      } catch (e) { console.warn('[Booking] Payment session failed:', e.message); }
    } else {
      await booking.update({ paymentStatus: 'paid' });
    }

    // Decrement available_spots in parking_lot.locations
    await this.sequelize.query(
      `UPDATE parking_lot.locations SET available_spots = available_spots - 1 WHERE id = :id AND available_spots > 0`,
      { replacements: { id: locationId } },
    );

    const formatted = formatBooking(booking.toJSON());
    this.logSvc.logBookingCreated({ booking: formatted, userId: authId });
    if (user?.email)
      this.emailSvc.sendBookingConfirmation(user.email, { ...formatted, locationName: location.name }).catch(() => {});
    this.notifSvc.notifyBookingConfirmed(authId, formatted);

    return { ...formatted, checkoutUrl };
  }

  async getMyBookings(authId: string, query: any = {}): Promise<any> {
    const { page = '1', limit = '100', status, search } = query;
    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, parseInt(limit));
    const where: any = { userId: authId };

    if (status) {
      where.status = status;
    }

    if (search) {
      where[Op.or] = [
        { reference: { [Op.iLike]: `%${search}%` } },
        { locationName: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { rows, count: total } = await this.bookingModel.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: l,
      offset: (p - 1) * l,
      distinct: true,
    });

    // Sync payment status dynamically for any pending bookings returned
    for (const b of rows) {
      if (b.paymentStatus === 'pending' && b.paymentSessionId) {
        try {
          const payment = await this.paymentSvc.getPaymentStatus(b.paymentSessionId);
          if (payment && payment.status === 'paid') {
            await b.update({ paymentStatus: 'paid' });
          }
        } catch (err) {
          console.warn('[SyncPayment] Failed to sync payment status:', err.message);
        }
      }
    }

    // Fetch all slot floors to dynamically map floor to each booking
    const [slots]: [any[], unknown] = await this.sequelize.query(
      `SELECT id, label, floor FROM parking_lot.parking_slots`
    );
    const slotFloorMap = new Map<string, string>();
    const slotLabelFloorMap = new Map<string, string>();
    for (const slot of slots) {
      if (slot.id) slotFloorMap.set(String(slot.id), String(slot.floor || '1'));
      if (slot.label) slotLabelFloorMap.set(String(slot.label), String(slot.floor || '1'));
    }

    return {
      bookings: rows.map((b) => {
        const formatted = formatBooking(b.toJSON());
        const floor = b.parkingSlotId ? slotFloorMap.get(String(b.parkingSlotId)) : slotLabelFloorMap.get(String(b.spot));
        return {
          ...formatted,
          floor: floor || '1',
          timing: computeTimingMeta(b.toJSON())
        };
      }),
      total,
      page: p,
      totalPages: Math.ceil(total / l),
    };
  }

  async getAllBookings(query: any, user: any): Promise<any> {
    const { page = '1', limit = '20', status, date: filterDate, locationId, reference } = query;
    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, parseInt(limit));
    const where: any = {};
    if (status)      where.status   = status;
    if (filterDate)  where.date     = filterDate;
    if (reference)   where.reference = { [Op.iLike]: `%${reference}%` };

    // Scope by role — all via parking_lot.locations.owner_id
    if (user.role === 'business_partner') {
      const myLoc = await this.locationModel.findOne({ where: { ownerId: user.authId } });
      if (!myLoc) return { bookings: [], total: 0, page: p, totalPages: 0 };
      where.locationId = String(myLoc.id);
    } else if (locationId) {
      where.locationId = String(locationId);
    }

    const { rows, count: total } = await this.bookingModel.findAndCountAll({
      where, order: [['createdAt', 'DESC']], limit: l, offset: (p - 1) * l, distinct: true,
    });
    return {
      bookings: rows.map((b) => formatBooking(b.toJSON())),
      total, page: p, totalPages: Math.ceil(total / l),
    };
  }

  async getBookingById(id: string, user: any): Promise<any> {
    const booking = await this.bookingModel.findByPk(id);
    if (!booking) throw new Error('Booking not found');
    
    // Sync payment status dynamically
    if (booking.paymentStatus === 'pending' && booking.paymentSessionId) {
      try {
        const payment = await this.paymentSvc.getPaymentStatus(booking.paymentSessionId);
        if (payment && payment.status === 'paid') {
          await booking.update({ paymentStatus: 'paid' });
        }
      } catch (err) {
        console.warn('[SyncPayment] Failed to sync payment status:', err.message);
      }
    }

    // Customers may only see their own
    if (user.role === 'customer' && booking.userId !== user.authId)
      throw new Error('Not authorized');
    return { ...formatBooking(booking.toJSON()), timing: computeTimingMeta(booking.toJSON()) };
  }

  async cancelBooking(id: string, user: any, reason?: string): Promise<any> {
    const booking = await this.bookingModel.findByPk(id);
    if (!booking) throw new Error('Booking not found');
    if (user.role === 'customer' && booking.userId !== user.authId)
      throw new Error('Not authorized to cancel this booking');
    if (!['upcoming'].includes(booking.status))
      throw new Error('Only upcoming bookings can be cancelled');

    const policy = computeRefundPolicy(booking.toJSON());
    let refundAmount = 0;
    if (policy.refundPct > 0 && booking.paymentStatus === 'paid' && booking.paymentSessionId) {
      refundAmount = Math.round(booking.amount * policy.refundPct) / 100;
      try {
        await this.paymentSvc.refundPayment(booking.paymentSessionId, refundAmount, reason || 'Customer cancelled');
      } catch (e) { console.warn('[Booking] Refund failed:', e.message); }
    }

    await booking.update({ status: 'cancelled' });
    // Restore available_spots
    await this.sequelize.query(
      `UPDATE parking_lot.locations SET available_spots = available_spots + 1 WHERE id = :id`,
      { replacements: { id: booking.locationId } },
    );
    // Restore slot status
    if ((booking as any).parkingSlotId) {
      await this.sequelize.query(
        `UPDATE parking_lot.parking_slots SET status = 'available' WHERE id = :slotId`,
        { replacements: { slotId: (booking as any).parkingSlotId } }
      );
    }

    const formatted = formatBooking(booking.toJSON());
    this.logSvc.logBookingCancelled({ booking: formatted, userId: user.authId, reason, refundAmount, refundType: policy.refundType, isRefund: refundAmount > 0 });
    this.notifSvc.notifyBookingCancelled(user.authId, formatted, reason);
    return { ...formatted, refundAmount, refundPolicy: policy };
  }

  async updateBookingStatus(id: string, staffUser: any, status: string, reason?: string): Promise<any> {
    const booking = await this.bookingModel.findByPk(id);
    if (!booking) throw new Error('Booking not found');
    await booking.update({ status });
    if (status === 'cancelled') {
      await this.sequelize.query(
        `UPDATE parking_lot.locations SET available_spots = available_spots + 1 WHERE id = :id`,
        { replacements: { id: booking.locationId } },
      );
      if ((booking as any).parkingSlotId) {
        await this.sequelize.query(
          `UPDATE parking_lot.parking_slots SET status = 'available' WHERE id = :slotId`,
          { replacements: { slotId: (booking as any).parkingSlotId } }
        );
      }
      this.notifSvc.notifyBookingCancelled(String(booking.userId), formatBooking(booking.toJSON()), reason);
    }
    return formatBooking(booking.toJSON());
  }

  async checkInBooking(id: string, staffUser: any): Promise<any> {
    const booking = await this.bookingModel.findByPk(id);
    if (!booking) throw new Error('Booking not found');
    if (booking.status !== 'upcoming') throw new Error('Only upcoming bookings can be checked in');
    if (booking.checkInAt)             throw new Error('Already checked in');
    await booking.update({ status: 'active', checkInAt: new Date(), checkedInByTeller: true });
    
    // Mark slot as occupied
    if ((booking as any).parkingSlotId) {
      await this.sequelize.query(
        `UPDATE parking_lot.parking_slots SET status = 'occupied' WHERE id = :slotId`,
        { replacements: { slotId: (booking as any).parkingSlotId } }
      );
    }
    
    const formatted = formatBooking(booking.toJSON());
    this.logSvc.logBookingCheckIn({ booking: formatted, adminId: staffUser.authId });
    return formatted;
  }

  async checkOutBooking(id: string, staffUser: any): Promise<any> {
    const booking = await this.bookingModel.findByPk(id);
    if (!booking) throw new Error('Booking not found');
    if (booking.status !== 'active') throw new Error('Only active bookings can be checked out');
    
    const checkInAt    = booking.checkInAt ? new Date(booking.checkInAt) : new Date();
    const checkOutAt   = new Date();
    const elapsedMs    = Math.max(0, checkOutAt.getTime() - checkInAt.getTime());
    const elapsedHrs   = elapsedMs / (1000 * 60 * 60);
    
    const FREE_HOURS    = 2;   // first 2 hours are free
    const RATE_PER_HOUR = 15;  // ₱15 per overtime hour
    
    const overtimeHrs  = Math.max(0, elapsedHrs - FREE_HOURS);   // hours beyond the free window
    const billableHrs  = Math.ceil(overtimeHrs);                  // round up to next hour
    const finalAmount  = billableHrs * RATE_PER_HOUR;             // ₱0 if still within 2 hrs

    await booking.update({ status: 'completed', checkOutAt, finalAmount });

    // Restore spot
    await this.sequelize.query(
      `UPDATE parking_lot.locations SET available_spots = available_spots + 1 WHERE id = :id`,
      { replacements: { id: booking.locationId } },
    );
    // Restore slot status
    if ((booking as any).parkingSlotId) {
      await this.sequelize.query(
        `UPDATE parking_lot.parking_slots SET status = 'available' WHERE id = :slotId`,
        { replacements: { slotId: (booking as any).parkingSlotId } }
      );
    }
    
    const formatted = formatBooking(booking.toJSON());
    this.logSvc.logBookingCheckOut({ booking: formatted, adminId: staffUser.authId });
    
    const durationMins = Math.round(elapsedMs / 60000);
    const overtimeMins = Math.max(0, durationMins - FREE_HOURS * 60);

    return {
      ...formatted,
      billing: {
        checkInAt:      checkInAt.toISOString(),
        checkOutAt:     checkOutAt.toISOString(),
        durationMins,
        durationLabel:  durationMins < 60
          ? `${durationMins} min`
          : `${Math.floor(durationMins / 60)}h ${durationMins % 60}m`,
        freeHours:      FREE_HOURS,
        overtimeMins,
        overtimeLabel:  overtimeMins <= 0 ? 'None'
          : overtimeMins < 60 ? `${overtimeMins} min`
          : `${Math.floor(overtimeMins / 60)}h ${overtimeMins % 60}m`,
        ratePerHour:    RATE_PER_HOUR,
        billableHours:  billableHrs,
        finalAmount,
      }
    };
  }

  async getAvailableSlots(locationId: string, date: string): Promise<any> {
    const location = await this.locationModel.findByPk(locationId);
    if (!location) throw new Error('Location not found');
    const bookedSlots = await this.bookingModel.findAll({
      where: { locationId: String(locationId), date: String(date), status: { [Op.in]: ['upcoming', 'active'] } },
      attributes: ['timeSlot', 'spot'],
      raw: true,
    });
    return { locationId, date, totalSpots: location.totalSpots, availableSpots: location.availableSpots, bookedSlots };
  }
}
