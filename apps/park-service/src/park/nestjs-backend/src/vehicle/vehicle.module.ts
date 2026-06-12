import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { VehicleModel } from '../models/vehicle.model';
import { VehicleController } from './vehicle.controller';

@Module({
  imports: [SequelizeModule.forFeature([VehicleModel])],
  controllers: [VehicleController],
})
export class VehicleModule {}
