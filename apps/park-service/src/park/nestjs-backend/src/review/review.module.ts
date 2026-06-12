import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ReviewModel } from '../models/review.model';
import { UserModel } from '../models/user.model';
import { LocationModel } from '../models/location.model';
import { ReviewController } from './review.controller';

@Module({
  imports: [SequelizeModule.forFeature([ReviewModel, UserModel, LocationModel])],
  controllers: [ReviewController],
})
export class ReviewModule {}
