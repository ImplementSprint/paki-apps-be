import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';

// Analytics uses only raw Sequelize queries (schema-qualified), no ORM models.
@Module({
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
