import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { ParkingSlotModel } from '../models/parking-slot.model';
import { BookingModel } from '../models/booking.model';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { computeTimingMeta, deriveDashboardStatus, recommendedPollIntervalMs } from '../common/time.utils';
import { Op } from 'sequelize';

@Controller('parking-slots')
@UseGuards(JwtAuthGuard)
export class ParkingSlotController {
  constructor(
    @InjectModel(ParkingSlotModel) private slotModel: typeof ParkingSlotModel,
    @InjectModel(BookingModel) private bookingModel: typeof BookingModel,
  ) {}

  @Get()
  async getSlots(@Query('locationId') locationId: string) {
    try {
      const where: any = {};
      if (locationId) where.locationId = locationId;
      const slots = await this.slotModel.findAll({ where, order: [['floor', 'ASC'], ['label', 'ASC']] });
      return { success: true, data: slots.map((s) => s.toJSON()) };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get('dashboard')
  @Roles('admin', 'teller', 'business_partner')
  async getDashboard(@Query('locationId') locationId: string) {
    try {
      if (!locationId) return { success: false, message: 'locationId is required' };
      const today = new Date().toISOString().split('T')[0];
      const [slots, activeBookings] = await Promise.all([
        this.slotModel.findAll({ where: { locationId }, order: [['floor', 'ASC'], ['label', 'ASC']] }),
        this.bookingModel.findAll({ where: { locationId: String(locationId), status: { [Op.in]: ['upcoming', 'active'] }, date: today }, raw: true }),
      ]);
      const bookingBySpot: Record<string, any> = {};
      for (const b of activeBookings) bookingBySpot[(b as any).spot] = b;

      const enriched = slots.map((slot) => {
        const s = slot.toJSON() as any;
        const booking = bookingBySpot[s.label] || null;
        const timing = booking ? computeTimingMeta(booking) : null;
        const dashStatus = deriveDashboardStatus(s.status, booking, timing);
        return { ...s, booking, timing, dashStatus };
      });

      const timingMetas = enriched.map((s) => s.timing).filter(Boolean);
      const pollInterval = recommendedPollIntervalMs(timingMetas);

      return { success: true, data: { slots: enriched, pollIntervalMs: pollInterval, summary: {
        total: enriched.length,
        available: enriched.filter((s) => s.dashStatus === 'available').length,
        occupied: enriched.filter((s) => ['occupied', 'arriving_soon', 'in_grace_period'].includes(s.dashStatus)).length,
        maintenance: enriched.filter((s) => s.dashStatus === 'maintenance').length,
      }}};
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Post()
  @Roles('admin', 'business_partner')
  async createSlot(@Body() body: any) {
    try {
      const slot = await this.slotModel.create(body);
      return { success: true, data: slot.toJSON() };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Post('bulk')
  @Roles('admin', 'business_partner')
  async bulkCreate(@Body() body: any) {
    try {
      const { slots } = body;
      if (!Array.isArray(slots)) return { success: false, message: 'slots must be an array' };
      const created = await this.slotModel.bulkCreate(slots);
      return { success: true, data: created.map((s) => s.toJSON()) };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Put(':id')
  @Roles('admin', 'teller', 'business_partner')
  async updateSlot(@Param('id') id: string, @Body() body: any) {
    try {
      const slot = await this.slotModel.findByPk(parseInt(id));
      if (!slot) return { success: false, message: 'Slot not found' };
      await slot.update(body);
      return { success: true, data: slot.toJSON() };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Delete(':id')
  @Roles('admin')
  async deleteSlot(@Param('id') id: string) {
    try {
      const slot = await this.slotModel.findByPk(parseInt(id));
      if (!slot) return { success: false, message: 'Slot not found' };
      await slot.destroy();
      return { success: true, message: 'Slot deleted' };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Patch(':id/status')
  @Roles('admin', 'teller', 'business_partner')
  async updateSlotStatus(@Param('id') id: string, @Body() body: any) {
    try {
      const slot = await this.slotModel.findByPk(parseInt(id));
      if (!slot) return { success: false, message: 'Slot not found' };
      await slot.update({ status: body.status });
      return { success: true, data: slot.toJSON() };
    } catch (e) { return { success: false, message: e.message }; }
  }
}
