import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BookingModel } from '../models/booking.model';
import { SchedulerService } from './scheduler.service';
import { SmsModule } from '../sms/sms.module';
import { EmailModule } from '../email/email.module';

// LocationModel removed — available_spots updated via raw SQL on parking_lot.locations
@Module({
  imports: [
    SequelizeModule.forFeature([BookingModel]),
    SmsModule,
    EmailModule
  ],
  providers: [SchedulerService],
})
export class SchedulerModule {}
