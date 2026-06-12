import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { UserModel } from '../models/user.model';
import { UserController } from './user.controller';

@Module({
  imports: [SequelizeModule.forFeature([UserModel])],
  controllers: [UserController],
  exports: [SequelizeModule],
})
export class UserModule {}
