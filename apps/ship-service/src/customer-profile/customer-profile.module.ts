import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CustomerNotificationsModule } from "../customer-notifications/customer-notifications.module";
import { CustomerProfileController } from "./customer-profile.controller";
import { CustomerProfileService } from "./customer-profile.service";

@Module({
  imports: [AuthModule, CustomerNotificationsModule],
  controllers: [CustomerProfileController],
  providers: [CustomerProfileService],
})
export class CustomerProfileModule {}
