import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BookingModel } from '../models/booking.model';
import { LocationModel } from '../models/location.model';
import { VehicleModel } from '../models/vehicle.model';
import { BookingService } from './booking.service';
import { BookingController } from './booking.controller';
import { PaymentModule } from '../payment/payment.module';
import { EmailModule } from '../email/email.module';

@Module({
  // UserModel removed — user data fetched via raw SQL from account.profiles
  imports: [SequelizeModule.forFeature([BookingModel, LocationModel, VehicleModel]), PaymentModule, EmailModule],
  providers: [BookingService],
  controllers: [BookingController],
  exports: [BookingService],
})
export class BookingModule {}
