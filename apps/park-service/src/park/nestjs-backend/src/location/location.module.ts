import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { LocationModel } from '../models/location.model';
import { ParkingSlotModel } from '../models/parking-slot.model';
import { LocationController } from './location.controller';

@Module({
  imports: [SequelizeModule.forFeature([LocationModel, ParkingSlotModel])],
  controllers: [LocationController],
  exports: [SequelizeModule],
})
export class LocationModule {}
