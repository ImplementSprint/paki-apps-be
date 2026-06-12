import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { BookingService } from './booking.service';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';

@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingController {
  constructor(private bookingService: BookingService) {}

  @Post()
  async createBooking(@Req() req: any, @Body() body: any) {
    try {
      const result = await this.bookingService.createBooking(req.user.authId, body);
      return { success: true, data: result };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get('my')
  async getMyBookings(@Req() req: any, @Query() query: any) {
    try {
      return { success: true, data: await this.bookingService.getMyBookings(req.user.authId, query) };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get('slots/:locationId')
  async getAvailableSlots(@Param('locationId') locationId: string, @Query('date') date: string) {
    try {
      return { success: true, data: await this.bookingService.getAvailableSlots(locationId, date) };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get()
  @Roles('admin', 'teller', 'business_partner')
  async getAllBookings(@Req() req: any, @Query() query: any) {
    try {
      return { success: true, data: await this.bookingService.getAllBookings(query, req.user) };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get(':id')
  async getBookingById(@Param('id') id: string, @Req() req: any) {
    try {
      return { success: true, data: await this.bookingService.getBookingById(id, req.user) };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Patch(':id/cancel')
  async cancelBooking(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    try {
      return { success: true, data: await this.bookingService.cancelBooking(id, req.user, body.reason) };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Patch(':id/status')
  @Roles('admin', 'teller', 'business_partner')
  async updateBookingStatus(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    try {
      return { success: true, data: await this.bookingService.updateBookingStatus(id, req.user, body.status, body.reason) };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Patch(':id/checkin')
  @Roles('admin', 'teller', 'business_partner')
  async checkIn(@Param('id') id: string, @Req() req: any) {
    try {
      return { success: true, data: await this.bookingService.checkInBooking(id, req.user) };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Patch(':id/checkout')
  @Roles('admin', 'teller', 'business_partner')
  async checkOut(@Param('id') id: string, @Req() req: any) {
    try {
      return { success: true, data: await this.bookingService.checkOutBooking(id, req.user) };
    } catch (e) { return { success: false, message: e.message }; }
  }
}
