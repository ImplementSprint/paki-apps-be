import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { UserModel } from '../models/user.model';
import { VehicleModel } from '../models/vehicle.model';
import { UploadModel } from '../models/upload.model';
import { UploadController } from './upload.controller';

@Module({
  imports: [SequelizeModule.forFeature([UserModel, VehicleModel, UploadModel])],
  controllers: [UploadController],
})
export class UploadModule {}
