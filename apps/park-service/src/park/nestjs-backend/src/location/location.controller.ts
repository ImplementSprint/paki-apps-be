import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { LocationModel } from '../models/location.model';
import { ParkingSlotModel } from '../models/parking-slot.model';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes } from 'sequelize';

@Controller('locations')
@UseGuards(JwtAuthGuard)
export class LocationController {
  constructor(
    @InjectModel(LocationModel) private locationModel: typeof LocationModel,
    @InjectModel(ParkingSlotModel) private slotModel: typeof ParkingSlotModel,
    private sequelize: Sequelize,
  ) {}

  private async getScopedHubIds(user: any): Promise<string[] | null> {
    if (user.role === 'admin') return null; // no restriction
    if (user.role === 'business_partner') {
      const locs = await this.locationModel.findAll({ where: { ownerId: user.authId }, attributes: ['id'], raw: true });
      return locs.map((l: any) => String(l.id));
    }
    if (user.role === 'teller') {
      // parking_lot.parking_slots has no tellerUserId column — return all locations for now
      const locs = await this.locationModel.findAll({ attributes: ['id'], raw: true });
      return locs.map((l: any) => String(l.id));
    }
    return null;
  }

  @Get()
  async getLocations(@Req() req: any, @Query('status') status?: string) {
    try {
      const where: any = {};
      if (status) where.status = status;
      const scopedIds = await this.getScopedHubIds(req.user);
      if (scopedIds !== null) where.id = scopedIds;
      const locations = await this.locationModel.findAll({ where, order: [['createdAt', 'DESC']] });
      
      const [slotStats]: [any[], unknown] = await this.sequelize.query(`
        SELECT location_id,
               COUNT(*) as total_spots,
               SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available_spots
        FROM parking_lot.parking_slots
        GROUP BY location_id
      `);

      const statsMap = new Map<string, { total: number; available: number }>();
      for (const stat of slotStats) {
        statsMap.set(String(stat.location_id), { 
          total: parseInt(stat.total_spots || '0', 10), 
          available: parseInt(stat.available_spots || '0', 10) 
        });
      }

      return {
        success: true,
        data: locations.map((l) => {
          const json = l.toJSON();
          const stats = statsMap.get(String(json.id));
          
          // Strictly enforce availability from parking_slots table.
          // If no slots exist in the table for this location, availability is 0.
          json.totalSpots = stats ? stats.total : 0;
          json.availableSpots = stats ? stats.available : 0;

          return { ...json, hourlyRate: json.pricePerHour };
        }),
      };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get(':id')
  async getLocationById(@Param('id') id: string, @Req() req: any) {
    try {
      const location = await this.locationModel.findByPk(id);
      if (!location) return { success: false, message: 'Location not found' };
      const scopedIds = await this.getScopedHubIds(req.user);
      if (scopedIds !== null && !scopedIds.includes(String(id))) return { success: false, message: 'Access denied' };
      const json = location.toJSON();

      const [slotStats]: [any[], unknown] = await this.sequelize.query(`
        SELECT COUNT(*) as total_spots, SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available_spots
        FROM parking_lot.parking_slots WHERE location_id = :id
      `, { replacements: { id: String(id) } });

      // Strictly enforce availability from parking_slots table.
      if (slotStats && slotStats.length > 0 && parseInt(slotStats[0].total_spots || '0', 10) > 0) {
        json.totalSpots = parseInt(slotStats[0].total_spots || '0', 10);
        json.availableSpots = parseInt(slotStats[0].available_spots || '0', 10);
      } else {
        json.totalSpots = 0;
        json.availableSpots = 0;
      }

      return { success: true, data: { ...json, hourlyRate: json.pricePerHour } };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Post()
  @Roles('admin')
  async createLocation(@Body() body: any) {
    try {
      const location = await this.locationModel.create(body);
      const json = location.toJSON();
      return { success: true, data: { ...json, hourlyRate: json.pricePerHour } };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Put(':id')
  @Roles('admin', 'business_partner')
  async updateLocation(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    try {
      const location = await this.locationModel.findByPk(id);
      if (!location) return { success: false, message: 'Location not found' };
      if (req.user.role === 'business_partner' && location.partnerUserId !== req.user.authId) return { success: false, message: 'Access denied' };
      await location.update(body);
      const json = location.toJSON();
      return { success: true, data: { ...json, hourlyRate: json.pricePerHour } };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Patch(':id/price')
  @Roles('admin', 'business_partner')
  async updatePrice(@Param('id') id: string, @Body() body: any) {
    try {
      const location = await this.locationModel.findByPk(id);
      if (!location) return { success: false, message: 'Location not found' };
      const price = body.pricePerHour !== undefined ? body.pricePerHour : body.hourlyRate;
      await location.update({ pricePerHour: price });
      const json = location.toJSON();
      return { success: true, data: { ...json, hourlyRate: json.pricePerHour } };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Patch(':id/hours')
  @Roles('admin', 'business_partner')
  async updateHours(@Param('id') id: string, @Body() body: any) {
    try {
      const location = await this.locationModel.findByPk(id);
      if (!location) return { success: false, message: 'Location not found' };
      await location.update({ operatingHours: body });
      const json = location.toJSON();
      return { success: true, data: { ...json, hourlyRate: json.pricePerHour } };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Delete(':id')
  @Roles('admin')
  async deleteLocation(@Param('id') id: string) {
    try {
      const location = await this.locationModel.findByPk(id);
      if (!location) return { success: false, message: 'Location not found' };
      await location.update({ status: 'inactive' });
      return { success: true, message: 'Location deactivated' };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get(':id/stats')
  async getLocationStats(@Param('id') id: string, @Req() req: any) {
    try {
      const [stats]: [any[], unknown] = await (this.sequelize as any).query(
        `SELECT COUNT(*) FILTER (WHERE status IN ('upcoming','active')) AS "activeBookings", COUNT(*) FILTER (WHERE date = :today) AS "todayBookings", COALESCE(SUM(amount) FILTER (WHERE "paymentStatus" = 'paid'), 0) AS "totalRevenue" FROM reservation.bookings WHERE "locationId" = :id`,
        { replacements: { id: String(id), today: new Date().toISOString().split('T')[0] } }
      );
      const location = await this.locationModel.findByPk(id, { raw: true });
      return { success: true, data: { ...location, hourlyRate: (location as any).pricePerHour, stats: stats[0] } };
    } catch (e) { return { success: false, message: e.message }; }
  }
}
