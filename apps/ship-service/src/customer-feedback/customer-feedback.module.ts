import { Module } from "@nestjs/common";
import { SupabaseModule } from "../supabase/supabase.module";
import { CustomerFeedbackController } from "./customer-feedback.controller";
import { CustomerFeedbackService } from "./customer-feedback.service";

@Module({
  imports: [SupabaseModule],
  controllers: [CustomerFeedbackController],
  providers: [CustomerFeedbackService],
})
export class CustomerFeedbackModule {}
