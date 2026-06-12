import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { PaymentMethodModel } from '../models/payment-method.model';
import { PaymentMethodController } from './payment-method.controller';

@Module({
  imports: [SequelizeModule.forFeature([PaymentMethodModel])],
  controllers: [PaymentMethodController],
})
export class PaymentMethodModule {}
