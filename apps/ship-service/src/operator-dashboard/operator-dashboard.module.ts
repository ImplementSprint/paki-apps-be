import { Module } from "@nestjs/common";
import { CustomerNotificationsModule } from "../customer-notifications/customer-notifications.module";
import { ParcelDraftsRepository } from "../parcel-drafts/parcel-drafts.repository";
import { SupabaseModule } from "../supabase/supabase.module";
import { OperatorDashboardController } from "./operator-dashboard.controller";
import { OperatorDashboardService } from "./operator-dashboard.service";

@Module({
  imports: [SupabaseModule, CustomerNotificationsModule],
  controllers: [OperatorDashboardController],
  providers: [OperatorDashboardService, ParcelDraftsRepository],
})
export class OperatorDashboardModule {}
