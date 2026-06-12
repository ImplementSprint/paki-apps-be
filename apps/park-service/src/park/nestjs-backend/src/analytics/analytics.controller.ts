import { Controller, Get, UseGuards } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes } from 'sequelize';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';

/**
 * AnalyticsController — all SQL is schema-qualified. Zero public schema usage.
 *
 * Schemas used:
 *   reservation.bookings
 *   account.profiles
 *   parking_lot.locations
 *   parking_lot.parking_slots
 */
@Controller('analytics')
@UseGuards(JwtAuthGuard)
@Roles('admin', 'teller', 'business_partner')
export class AnalyticsController {
  constructor(private sequelize: Sequelize) {}

  @Get('dashboard')
  async getDashboardStats() {
    try {
      const [[bookingRow], [userRow], [locationRow], [spotRow], [revenueRow]] = await Promise.all([
        this.sequelize.query(
          `SELECT COUNT(*)::int AS total FROM reservation.bookings`,
          { type: QueryTypes.SELECT }),
        this.sequelize.query(
          `SELECT COUNT(*)::int AS total FROM account.profiles WHERE role = 'customer'`,
          { type: QueryTypes.SELECT }),
        this.sequelize.query(
          `SELECT COUNT(*)::int AS total FROM parking_lot.locations WHERE is_active = true`,
          { type: QueryTypes.SELECT }),
        this.sequelize.query(
          `SELECT COALESCE(SUM(total_spots),0)::int AS total FROM parking_lot.locations WHERE is_active = true`,
          { type: QueryTypes.SELECT }),
        this.sequelize.query(
          `SELECT COALESCE(SUM(amount),0)::float AS total FROM reservation.bookings WHERE "paymentStatus" = 'paid'`,
          { type: QueryTypes.SELECT }),
      ]);
      return { success: true, data: {
        totalBookings:  (bookingRow as any).total,
        activeUsers:    (userRow as any).total,
        totalLocations: (locationRow as any).total,
        parkingSpots:   (spotRow as any).total,
        revenue:        (revenueRow as any).total,
      }};
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get('revenue')
  async getRevenueData() {
    try {
      const data = await this.sequelize.query(
        `SELECT TO_CHAR(DATE_TRUNC('month', "createdAt"), 'YYYY-MM') AS month,
                SUM(amount)::float  AS revenue,
                COUNT(*)::int       AS bookings
         FROM reservation.bookings
         WHERE "paymentStatus" = 'paid'
           AND "createdAt" >= now() - INTERVAL '6 months'
         GROUP BY DATE_TRUNC('month', "createdAt")
         ORDER BY DATE_TRUNC('month', "createdAt") ASC`,
        { type: QueryTypes.SELECT },
      );
      return { success: true, data };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get('occupancy')
  async getOccupancyData() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const data = await this.sequelize.query(
        `SELECT "timeSlot", COUNT(*)::int AS count
         FROM reservation.bookings
         WHERE date = :today AND status IN ('upcoming','active')
         GROUP BY "timeSlot"
         ORDER BY "timeSlot" ASC`,
        { replacements: { today }, type: QueryTypes.SELECT },
      );
      return { success: true, data };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get('vehicle-types')
  async getVehicleTypeDistribution() {
    try {
      const data = await this.sequelize.query(
        `SELECT "vehicleType" AS type, COUNT(*)::int AS count
         FROM reservation.bookings
         WHERE "vehicleType" IS NOT NULL
         GROUP BY "vehicleType"
         ORDER BY count DESC`,
        { type: QueryTypes.SELECT },
      );
      return { success: true, data };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get('payment-methods')
  async getPaymentMethodDistribution() {
    try {
      const data = await this.sequelize.query(
        `SELECT payment_method AS method, COUNT(*)::int AS count
         FROM payment.payment_transactions
         GROUP BY payment_method
         ORDER BY count DESC`,
        { type: QueryTypes.SELECT },
      );
      return { success: true, data };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get('slot-utilisation')
  async getSlotUtilisation() {
    try {
      const data = await this.sequelize.query(
        `SELECT pl.name AS location, ps.label AS slot,
                COUNT(rb.id)::int AS totalBookings,
                ROUND(AVG(EXTRACT(EPOCH FROM (rb."checkOutAt" - rb."checkInAt")) / 3600)::numeric, 2)::float AS avgHours
         FROM parking_lot.parking_slots ps
         JOIN parking_lot.locations pl ON pl.id = ps.location_id
         LEFT JOIN reservation.bookings rb ON rb."locationId"::int = ps.location_id
           AND rb.spot = ps.label AND rb.status = 'completed'
         GROUP BY pl.name, ps.label
         ORDER BY totalBookings DESC
         LIMIT 50`,
        { type: QueryTypes.SELECT },
      );
      return { success: true, data };
    } catch (e) { return { success: false, message: e.message }; }
  }
}
