import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ParkingSlotModel } from '../models/parking-slot.model';
import { BookingModel } from '../models/booking.model';
import { ParkingSlotController } from './parking-slot.controller';

@Module({
  imports: [SequelizeModule.forFeature([ParkingSlotModel, BookingModel])],
  controllers: [ParkingSlotController],
})
export class ParkingSlotModule {}
