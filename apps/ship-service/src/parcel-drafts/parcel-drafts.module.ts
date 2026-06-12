import { Module } from "@nestjs/common";
import { CustomerNotificationsModule } from "../customer-notifications/customer-notifications.module";
import { ParcelDraftsController } from "./parcel-drafts.controller";
import { ParcelDraftsRepository } from "./parcel-drafts.repository";
import { ParcelDraftsService } from "./parcel-drafts.service";
import { SupabaseModule } from "../supabase/supabase.module";
import { GoogleMapsModule } from "../google-maps/google-maps.module";

@Module({
  imports: [CustomerNotificationsModule, SupabaseModule, GoogleMapsModule],
  controllers: [ParcelDraftsController],
  providers: [ParcelDraftsRepository, ParcelDraftsService],
})
export class ParcelDraftsModule {}
