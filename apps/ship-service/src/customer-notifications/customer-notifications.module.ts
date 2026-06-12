import { Module } from "@nestjs/common";
import { CustomerNotificationsController } from "./customer-notifications.controller";
import { CustomerNotificationsService } from "./customer-notifications.service";

@Module({
  controllers: [CustomerNotificationsController],
  providers: [CustomerNotificationsService],
  exports: [CustomerNotificationsService],
})
export class CustomerNotificationsModule {}
