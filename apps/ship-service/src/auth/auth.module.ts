import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { EmailService } from "./email.service";

@Module({
  controllers: [AuthController],
  providers: [AuthService, EmailService],
  exports: [EmailService],
})
export class AuthModule {}
