import { Module } from "@nestjs/common";
import { CustomerNotificationsModule } from "./customer-notifications/customer-notifications.module";
import { AuthModule } from "./auth/auth.module";
import { CustomerDashboardModule } from "./customer-dashboard/customer-dashboard.module";
import { CustomerFeedbackModule } from "./customer-feedback/customer-feedback.module";
import { CustomerProfileModule } from "./customer-profile/customer-profile.module";
import { DriverDashboardModule } from "./driver-dashboard/driver-dashboard.module";
import { DropOffPointsModule } from "./drop-off-points/drop-off-points.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { ParcelDraftsModule } from "./parcel-drafts/parcel-drafts.module";
import { ProfileModule } from "./profile/profile.module";
import { SettingsModule } from "./settings/settings.module";
import { SupabaseModule } from "./supabase/supabase.module";
import { OperatorDashboardModule } from "./operator-dashboard/operator-dashboard.module";
import { GoogleMapsModule } from "./google-maps/google-maps.module";

@Module({
  imports: [
    SupabaseModule,
    GoogleMapsModule,
    AuthModule,
    CustomerNotificationsModule,
    CustomerDashboardModule,
    CustomerFeedbackModule,
    CustomerProfileModule,
    DriverDashboardModule,
    DropOffPointsModule,
    NotificationsModule,
    ParcelDraftsModule,
    OperatorDashboardModule,
    ProfileModule,
    SettingsModule,
  ],
})
export class AppModule {}
