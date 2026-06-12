import { Controller, Get, Post, Delete, Body, Param, Req, UseGuards, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { PaymentMethodModel } from '../models/payment-method.model';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

@Controller('payment-methods')
@UseGuards(JwtAuthGuard)
export class PaymentMethodController {
  constructor(@InjectModel(PaymentMethodModel) private pmModel: typeof PaymentMethodModel) {}

  /** List payment transactions for the current user */
  @Get()
  async getMyTransactions(@Req() req: any, @Query('status') status?: string) {
    try {
      const where: any = { userId: req.user.authId };
      if (status) where.status = status;
      const records = await this.pmModel.findAll({ where, order: [['createdAt', 'DESC']] });
      return { success: true, data: records.map((r) => r.toJSON()) };
    } catch (e) { return { success: false, message: e.message }; }
  }

  /** Record a new payment transaction (called internally after gateway confirmation) */
  @Post()
  async createTransaction(@Req() req: any, @Body() body: any) {
    try {
      const record = await this.pmModel.create({
        userId:              req.user.authId,
        paymentMethod:       body.payment_method || body.paymentMethod,
        amount:              body.amount,
        currency:            body.currency || 'PHP',
        status:              body.status || 'pending',
        referenceId:         body.reference_id || body.referenceId,
        gatewayTransactionId:body.gateway_transaction_id || body.gatewayTransactionId,
        sourceService:       body.source_service || body.sourceService || 'parking',
      });
      return { success: true, data: record.toJSON() };
    } catch (e) { return { success: false, message: e.message }; }
  }

  /** Get a single transaction */
  @Get(':id')
  async getTransaction(@Param('id') id: string, @Req() req: any) {
    try {
      const record = await this.pmModel.findOne({ where: { id: parseInt(id), userId: req.user.authId } });
      if (!record) return { success: false, message: 'Transaction not found' };
      return { success: true, data: record.toJSON() };
    } catch (e) { return { success: false, message: e.message }; }
  }
}
