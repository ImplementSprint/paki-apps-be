import { Controller, Post, Get, Body, Req, Query, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SmsService } from '../sms/sms.service';
import { SupabaseService } from '../common/supabase.service';
import { JwtAuthGuard, Public } from '../common/jwt-auth.guard';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(
    private authService: AuthService,
    private smsSvc: SmsService,
    private supabaseSvc: SupabaseService,
  ) {}

  @Public()
  @Post('register/customer')
  async registerCustomer(@Body() body: any) {
    try {
      const user = await this.authService.registerCustomer(body);
      return { success: true, data: user };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Public()
  @Post('register/admin')
  async registerAdmin(@Body() body: any) {
    try {
      const user = await this.authService.registerAdmin(body);
      return { success: true, data: user };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Public()
  @Post('login')
  async login(@Body() body: any) {
    try {
      const user = await this.authService.loginUser(body);
      return { success: true, data: user };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() body: any) {
    try {
      const tokens = await this.authService.refreshToken(body);
      return { success: true, data: tokens };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Public()
  @Post('logout')
  async logout(@Body() body: any) {
    try {
      await this.authService.logoutUser(body);
      return { success: true };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get('me')
  async getMe(@Req() req: any) {
    return { success: true, data: req.user };
  }

  @Public()
  @Get('check-identifier')
  async checkIdentifier(@Query('value') value: string) {
    try {
      if (!value) return { available: true };
      const available = await this.authService.checkIdentifier(value.trim());
      return { available };
    } catch (e) {
      console.error('[check-identifier]', e.message);
      return { available: true }; // fail open
    }
  }

  @Public()
  @Post('forgot-password/request')
  async requestPasswordReset(@Body() body: any) {
    try {
      const { identifier } = body;
      if (!identifier) return { success: false, message: 'Email or phone number is required.' };
      const user = await this.authService.findUserByIdentifier(identifier);
      if (!user) return { success: true, message: 'If that account exists, a code has been sent.' };
      if (this.authService.isEmailIdentifier(identifier)) {
        await this.smsSvc.sendPasswordResetOTPByEmail(identifier);
        return { success: true, message: `OTP sent to ${identifier.trim().toLowerCase()}`, channel: 'email' };
      } else {
        const canonical = await this.smsSvc.sendPasswordResetOTP(identifier);
        return { success: true, message: `OTP sent to ${canonical}`, channel: 'sms' };
      }
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Public()
  @Post('forgot-password/verify')
  async verifyResetOTP(@Body() body: any) {
    try {
      const { identifier, otp } = body;
      if (!identifier || !otp) return { success: false, message: 'identifier and otp are required.' };
      this.smsSvc.verifyOTP(identifier, otp);
      return { success: true, message: 'OTP verified. You may now reset your password.' };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Public()
  @Post('forgot-password/reset')
  async resetPassword(@Body() body: any) {
    try {
      const { identifier, otp, newPassword } = body;
      if (!identifier || !otp || !newPassword) return { success: false, message: 'identifier, otp, and newPassword are required.' };
      if (newPassword.length < 8) return { success: false, message: 'Password must be at least 8 characters.' };
      if (!this.smsSvc.isVerified(identifier)) return { success: false, message: 'OTP not verified. Please verify your code first.' };
      const user = await this.authService.findUserByIdentifier(identifier);
      if (!user) return { success: false, message: 'User not found.' };
      if (!user.supabaseId) return { success: false, message: 'Account not linked to auth system. Contact support.' };
      const sb = this.supabaseSvc.get();
      const { error } = await sb.auth.admin.updateUserById(user.supabaseId, { password: newPassword });
      if (error) throw new Error(error.message);
      this.smsSvc.consumeOTP(identifier);
      return { success: true, message: 'Password reset successfully. You can now log in.' };
    } catch (e) { return { success: false, message: e.message }; }
  }
}
