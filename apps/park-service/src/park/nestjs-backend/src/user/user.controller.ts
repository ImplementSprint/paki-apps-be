import { Controller, Get, Put, Post, Delete, Patch, Body, Param, Req, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { UserModel } from '../models/user.model';
import { SupabaseService } from '../common/supabase.service';
import { NotificationService } from '../notification/notification.service';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { SmsService } from '../sms/sms.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(
    @InjectModel(UserModel) private userModel: typeof UserModel,
    private supabaseSvc: SupabaseService,
    private notifSvc: NotificationService,
    private sequelize: Sequelize,
    private smsSvc: SmsService,
  ) {}

  @Get('profile')
  async getProfile(@Req() req: any) {
    try {
      const profile = await this.userModel.findByPk(req.user.authId);
      if (!profile) return { success: false, message: 'Profile not found' };

      // Query real-time statistics
      const [[{ totalBookings }]] = await this.sequelize.query(
        `SELECT COUNT(*)::int AS "totalBookings" FROM reservation.bookings WHERE user_id = :userId AND status != 'cancelled'`,
        { replacements: { userId: req.user.authId } }
      ) as any;

      const [[{ activeBookings }]] = await this.sequelize.query(
        `SELECT COUNT(*)::int AS "activeBookings" FROM reservation.bookings WHERE user_id = :userId AND status IN ('upcoming', 'checked_in')`,
        { replacements: { userId: req.user.authId } }
      ) as any;

      const [[{ savedVehicles }]] = await this.sequelize.query(
        `SELECT COUNT(*)::int AS "savedVehicles" FROM teller.vehicles WHERE user_id = :userId`,
        { replacements: { userId: req.user.authId } }
      ) as any;

      const json = profile.toJSON() as any;
      const prefs = json.notificationPreferences || {};
      const discountStatus = prefs.discountStatus || 'none';
      const discountPct = prefs.discountPct || (discountStatus === 'approved' ? 20 : 0);

      const resData = {
        _id: profile.id,
        id: profile.id,
        name: profile.fullName || '',
        firstName: profile.firstName || '',
        lastName: profile.lastName || '',
        email: profile.email || '',
        phone: profile.phone || '',
        dateOfBirth: profile.dob || '',
        address: profile.address || '',
        city: profile.city || '',
        province: profile.province || '',
        profilePicture: profile.profilePicture || '',
        isVerified: profile.isVerified || false,
        twoFactorEnabled: profile.twoFactorEnabled || false,
        preferences: prefs,
        totalBookings: totalBookings || 0,
        activeBookings: activeBookings || 0,
        savedVehicles: savedVehicles || 0,
        createdAt: profile.createdAt,
        discountStatus,
        discountPct,
      };

      return { success: true, data: resData };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Put('profile')
  async updateProfile(@Req() req: any, @Body() body: any) {
    try {
      const profile = await this.userModel.findByPk(req.user.authId);
      if (!profile) return { success: false, message: 'Profile not found' };

      const updates: any = {};
      if (body.name !== undefined || body.fullName !== undefined || (body.firstName && body.lastName)) {
        updates.full_name = body.name || body.fullName || `${body.firstName} ${body.lastName}`.trim();
      }
      if (body.phone !== undefined)          updates.phone           = body.phone;
      if (body.dateOfBirth !== undefined || body.dob !== undefined) {
        updates.dob = body.dateOfBirth || body.dob;
      }
      if (body.address !== undefined)        updates.address         = body.address;
      if (body.city !== undefined)           updates.city            = body.city;
      if (body.province !== undefined)       updates.province        = body.province;
      if (body.profilePicture !== undefined) updates.profile_picture = body.profilePicture;
      if (body.preferences !== undefined) {
        updates.notification_preferences = body.preferences;
      }

      if (Object.keys(updates).length) {
        const setParts = Object.keys(updates).map((k) => `"${k}" = :${k.replace(/_/g, '')}`).join(', ');
        await this.sequelize.query(
          `UPDATE account.profiles SET ${setParts} WHERE id = :id`,
          { replacements: { ...Object.fromEntries(Object.entries(updates).map(([k, v]) => [k.replace(/_/g, ''), typeof v === 'object' ? JSON.stringify(v) : v])), id: req.user.authId } },
        );
      }

      // Fetch the full updated profile and return in identical structure
      return this.getProfile(req);
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Post('verify-account/request')
  async requestAccountVerification(@Req() req: any, @Body() body: any) {
    try {
      const { channel } = body; // 'email' or 'sms'
      const profile = await this.userModel.findByPk(req.user.authId);
      if (!profile) return { success: false, message: 'Profile not found' };

      // Ensure customer has completed their personal info (name, dob, address, phone)
      const hasName = profile.fullName && profile.fullName.trim().length > 0;
      const hasDob = profile.dob && profile.dob.trim().length > 0;
      const hasAddress = profile.address && profile.address.trim().length > 0;
      const hasPhone = profile.phone && profile.phone.trim().length > 0;

      if (!hasName || !hasDob || !hasAddress || !hasPhone) {
        return {
          success: false,
          message: 'Please complete all personal information (Name, Phone, Birth Date, and Address) before initiating account verification.'
        };
      }

      if (channel === 'email') {
        const email = profile.email;
        if (!email) return { success: false, message: 'Email address is not configured on this profile.' };
        await this.smsSvc.sendVerificationOTPByEmail(email);
        return { success: true, message: `Verification OTP sent to ${email}`, channel: 'email' };
      } else {
        const phone = profile.phone;
        if (!phone) return { success: false, message: 'Phone number is not configured on this profile.' };
        const canonical = await this.smsSvc.sendVerificationOTP(phone);
        return { success: true, message: `Verification OTP sent to ${canonical}`, channel: 'sms' };
      }
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Post('verify-account/verify')
  async verifyAccountOTP(@Req() req: any, @Body() body: any) {
    try {
      const { otp } = body;
      if (!otp) return { success: false, message: 'OTP code is required.' };
      const profile = await this.userModel.findByPk(req.user.authId);
      if (!profile) return { success: false, message: 'Profile not found' };

      // Try verifying with both phone and email keys (depending on what was set)
      let verified = false;
      let errorMsg = 'Invalid OTP. Please try again.';

      if (profile.email) {
        try {
          this.smsSvc.verifyOTP(profile.email, otp);
          this.smsSvc.consumeOTP(profile.email);
          verified = true;
        } catch (err: any) { errorMsg = err.message; }
      }

      if (!verified && profile.phone) {
        try {
          this.smsSvc.verifyOTP(profile.phone, otp);
          this.smsSvc.consumeOTP(profile.phone);
          verified = true;
        } catch (err: any) { errorMsg = err.message; }
      }

      if (!verified) {
        return { success: false, message: errorMsg };
      }

      // Mark the user as verified in the DB!
      await this.sequelize.query(
        `UPDATE account.profiles SET is_verified = true WHERE id = :id`,
        { replacements: { id: req.user.authId } }
      );

      // Log activity
      try {
        await this.notifSvc.notify(
          req.user.authId,
          'account_verified',
          'Account Verified!',
          'Congratulations! Your profile has been successfully verified via OTP.'
        );
      } catch {}

      return { success: true, message: 'Account verified successfully!' };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Put('password')
  async changePassword(@Req() req: any, @Body() body: any) {
    try {
      const { newPassword } = body;
      if (!newPassword || newPassword.length < 8)
        return { success: false, message: 'New password must be at least 8 characters' };
      const sb = this.supabaseSvc.get();
      const { error } = await sb.auth.admin.updateUserById(req.user.authId, { password: newPassword });
      if (error) throw new Error(error.message);
      return { success: true, message: 'Password changed successfully' };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Delete('account')
  async deleteAccount(@Req() req: any) {
    try {
      // Soft-delete: disable in Supabase auth (no deleted_at column in account.profiles)
      const sb = this.supabaseSvc.get();
      await sb.auth.admin.updateUserById(req.user.authId, { ban_duration: 'none' });
      return { success: true, message: 'Account deactivated' };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Post('discount-request')
  async submitDiscountRequest(@Req() req: any, @Body() body: any) {
    try {
      const { discountIdUrl, discountType } = body;
      const fileUrl = discountIdUrl || null;
      const docType = discountType || 'PWD';

      // 1. Delete any existing pending/rejected for this profile_id to avoid duplicate pending list clutter
      await this.sequelize.query(
        `DELETE FROM account.document_verifications 
         WHERE profile_id = :id AND document_type = :docType`,
        { replacements: { id: req.user.authId, docType } }
      );

      // 2. Insert into account.document_verifications
      await this.sequelize.query(
        `INSERT INTO account.document_verifications (profile_id, document_type, file_url, status)
         VALUES (:profileId, :docType, :fileUrl, 'pending')`,
        { replacements: { profileId: req.user.authId, docType, fileUrl } }
      );

      // 3. Keep profile preferences JSONB in sync for profile UI state
      await this.sequelize.query(
        `UPDATE account.profiles
         SET notification_preferences = notification_preferences || :discountJson::jsonb
         WHERE id = :id`,
        { replacements: {
            discountJson: JSON.stringify({ discountStatus: 'pending', discountType: docType, discountIdUrl: fileUrl }),
            id: req.user.authId,
          } },
      );
      return { success: true, message: 'Discount request submitted for review' };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get('pending-discounts')
  @Roles('admin')
  async getPendingDiscounts() {
    try {
      const [rows]: [any[], unknown] = await this.sequelize.query(
        `SELECT dv.id AS "verificationId", ap.id AS "id", ap.full_name AS "full_name", 
                ap.email AS "email", ap.phone AS "phone", ap.notification_preferences, 
                dv.document_type AS "discountType", dv.file_url AS "discountIdUrl"
         FROM account.document_verifications dv
         JOIN account.profiles ap ON ap.id = dv.profile_id
         WHERE dv.status = 'pending'`,
      );
      return { success: true, data: rows };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Patch(':id/discount')
  @Roles('admin')
  async reviewDiscountRequest(@Param('id') id: string, @Body() body: any) {
    try {
      const { action } = body;
      const newStatus = action === 'approve' ? 'approved' : 'rejected';

      // Find user id (works whether 'id' is direct profile_id or verification row id)
      const [verRows]: any[] = await this.sequelize.query(
        `SELECT profile_id FROM account.document_verifications WHERE id = :id OR profile_id = :id LIMIT 1`,
        { replacements: { id } }
      );
      const userId = verRows[0]?.profile_id || id;

      // 1. Update verification document status
      await this.sequelize.query(
        `UPDATE account.document_verifications
         SET status = :status
         WHERE profile_id = :userId`,
        { replacements: { status: newStatus === 'approved' ? 'approved' : 'rejected', userId } }
      );

      // 2. Update profile state and eligibility for 20% discount
      const patchData = {
        discountStatus: newStatus,
        discountPct: newStatus === 'approved' ? 20 : 0
      };

      await this.sequelize.query(
        `UPDATE account.profiles
         SET notification_preferences = notification_preferences || :patch::jsonb
         WHERE id = :userId`,
        { replacements: { patch: JSON.stringify(patchData), userId } }
      );

      // Trigger notifications
      try {
        if (newStatus === 'approved') {
          await this.notifSvc.notifyDiscountApproved(userId);
        } else {
          await this.notifSvc.notifyDiscountRejected(userId);
        }
      } catch (notifErr) {
        console.warn('Non-fatal notification error:', notifErr.message);
      }

      return { success: true, message: `Discount ${newStatus}` };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get()
  @Roles('admin')
  async getAllUsers() {
    try {
      const [rows]: [any[], unknown] = await this.sequelize.query(
        `SELECT ap.id, ap.full_name, ap.email, ap.phone, ap.role, ap.is_verified,
                ap.profile_picture, ap.created_at,
                aa.admin_role, aa.is_active
         FROM account.profiles ap
         LEFT JOIN account.admin_accounts aa ON aa.profile_id = ap.id
         ORDER BY ap.created_at DESC`,
      );
      return { success: true, data: rows };
    } catch (e) { return { success: false, message: e.message }; }
  }
}
