import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { SettingsModel } from '../models/settings.model';
import { ParkingRateModel } from '../models/parking-rate.model';
import { SettingsController } from './settings.controller';

@Module({
  imports: [SequelizeModule.forFeature([SettingsModel, ParkingRateModel])],
  controllers: [SettingsController],
})
export class SettingsModule {}
