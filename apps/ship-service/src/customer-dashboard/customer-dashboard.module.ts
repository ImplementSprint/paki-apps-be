import { Module } from "@nestjs/common";
import { CustomerNotificationsModule } from "../customer-notifications/customer-notifications.module";
import { CustomerDashboardController } from "./customer-dashboard.controller";
import { CustomerDashboardService } from "./customer-dashboard.service";

@Module({
  imports: [CustomerNotificationsModule],
  controllers: [CustomerDashboardController],
  providers: [CustomerDashboardService],
})
export class CustomerDashboardModule {}
