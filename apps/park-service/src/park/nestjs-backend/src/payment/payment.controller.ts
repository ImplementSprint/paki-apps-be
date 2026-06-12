import { Controller, Get, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';

@Controller('payment')
@UseGuards(JwtAuthGuard)
export class PaymentController {
  constructor(private paymentService: PaymentService) {}

  @Post('checkout')
  async createCheckout(@Body() body: any) {
    try {
      const { amount, referenceId, description, currency, successUrl, cancelUrl, method } = body;
      if (!amount || !referenceId) return { success: false, message: 'amount and referenceId are required' };
      const session = await this.paymentService.createCheckoutSession({ amount: Number(amount), referenceId: String(referenceId), description, currency, successUrl, cancelUrl, method });
      return { success: true, data: session };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get(':sessionId')
  async getStatus(@Param('sessionId') sessionId: string) {
    try {
      return { success: true, data: await this.paymentService.getPaymentStatus(sessionId) };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Post(':sessionId/refund')
  @Roles('admin', 'teller')
  async refund(@Param('sessionId') sessionId: string, @Body() body: any) {
    try {
      return { success: true, data: await this.paymentService.refundPayment(sessionId, body.amount ? Number(body.amount) : undefined, body.reason) };
    } catch (e) { return { success: false, message: e.message }; }
  }
}
