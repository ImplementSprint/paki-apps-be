import { Controller, Post, Body, Req, UseInterceptors } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';

@Controller('api/payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('checkout')
  @UseInterceptors(IdempotencyInterceptor)
  async checkout(@Body() body: any, @Req() req: any) {
    return await this.paymentService.processCheckout(body);
  }
}
