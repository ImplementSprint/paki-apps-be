import { Module } from "@nestjs/common";
import { CustomerNotificationsModule } from "../customer-notifications/customer-notifications.module";
import { GoogleMapsModule } from "../google-maps/google-maps.module";
import { SupabaseModule } from "../supabase/supabase.module";
import { DriverDashboardController } from "./driver-dashboard.controller";
import { DriverDashboardService } from "./driver-dashboard.service";

@Module({
  imports: [SupabaseModule, CustomerNotificationsModule, GoogleMapsModule],
  controllers: [DriverDashboardController],
  providers: [DriverDashboardService],
})
export class DriverDashboardModule {}
