import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfilePhotoDto } from './dto/update-profile-photo.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import type { AdminProfile } from './interfaces/admin-profile.interface';

interface AccountProfileRow {
  address: string | null;
  city: string | null;
  dob: string | null;
  email: string | null;
  full_name: string | null;
  id: string;
  password_updated_at: string | null;
  phone: string | null;
  profile_picture: string | null;
  province: string | null;
  role: string | null;
}

interface AdminAccountRow {
  admin_role: string | null;
  id: string;
  is_active: boolean | null;
  last_login_at: string | null;
  profile_id: string;
}

type StoredAdminProfile = AdminProfile & {
  authUserId: string;
  updatedAt: string;
};

const DEFAULT_ADMIN_EMAIL = 'admin@gmail.com';

@Injectable()
export class ProfileService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getProfile() {
    return this.toPublicProfile(await this.loadProfile());
  }

  async updateProfile(dto: UpdateProfileDto) {
    const profile = await this.loadProfile();
    const updatedProfile = await this.updateProfileRow(profile.authUserId, {
      ...this.cleanProfileUpdate(dto),
      updatedAt: new Date().toISOString(),
    });

    return this.toPublicProfile(updatedProfile);
  }

  async updatePhoto(dto: UpdateProfilePhotoDto) {
    const profile = await this.loadProfile();
    const updatedProfile = await this.updateProfileRow(profile.authUserId, {
      profilePicture: dto.profilePicture,
      updatedAt: new Date().toISOString(),
    });

    return {
      profilePicture: updatedProfile.profilePicture,
      updatedAt: updatedProfile.updatedAt,
    };
  }

  async removePhoto() {
    const profile = await this.loadProfile();
    const updatedProfile = await this.updateProfileRow(profile.authUserId, {
      profilePicture: null,
      updatedAt: new Date().toISOString(),
    });

    return {
      profilePicture: null,
      updatedAt: updatedProfile.updatedAt,
    };
  }

  async changePassword(dto: ChangePasswordDto) {
    const profile = await this.loadProfile();

    if (!profile.email) {
      throw new BadRequestException('Admin profile does not have an email address.');
    }

    try {
      await this.supabaseService.signInWithPassword(profile.email, dto.currentPassword);
    } catch {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    await this.supabaseService.updateAuthUserPassword(profile.authUserId, dto.newPassword);
    const updatedProfile = await this.updateProfileRow(profile.authUserId, {
      updatedAt: new Date().toISOString(),
    });

    return {
      message: 'Password updated successfully.',
      updatedAt: updatedProfile.updatedAt,
    };
  }

  private async loadProfile() {
    const profileId = process.env.PAKISHIP_ADMIN_PROFILE_ID;
    const email = process.env.PAKISHIP_ADMIN_EMAIL ?? DEFAULT_ADMIN_EMAIL;
    const profile = profileId ? await this.findProfileById(profileId) : await this.findProfileByEmail(email);

    if (profile) {
      const adminAccount = await this.findAdminAccount(profile.id);

      if (!adminAccount) {
        throw new NotFoundException(
          `Profile ${profile.email ?? profile.id} exists, but it is not linked in account.admin_accounts.`,
        );
      }

      return this.toStoredProfile(profile, adminAccount);
    }

    const adminAccount = await this.findFirstActiveAdminAccount();

    if (!adminAccount) {
      throw new NotFoundException(
        'No PakiShip admin profile was found in account.profiles/account.admin_accounts. Set PAKISHIP_ADMIN_PROFILE_ID or PAKISHIP_ADMIN_EMAIL.',
      );
    }

    const adminProfile = await this.findProfileById(adminAccount.profile_id);

    if (!adminProfile) {
      throw new NotFoundException(`Admin account ${adminAccount.id} points to a missing profile.`);
    }

    return this.toStoredProfile(adminProfile, adminAccount);
  }

  private async findProfileById(id: string) {
    const rows = await this.supabaseService.select<AccountProfileRow>('account.profiles', {
      select: '*',
      id: `eq.${id}`,
      limit: 1,
    });

    return rows[0] ?? null;
  }

  private async findProfileByEmail(email: string) {
    const rows = await this.supabaseService.select<AccountProfileRow>('account.profiles', {
      select: '*',
      email: `eq.${email}`,
      limit: 1,
    });

    return rows[0] ?? null;
  }

  private async findAdminAccount(profileId: string) {
    const rows = await this.supabaseService.select<AdminAccountRow>('account.admin_accounts', {
      select: '*',
      profile_id: `eq.${profileId}`,
      limit: 1,
    });

    return rows[0] ?? null;
  }

  private async findFirstActiveAdminAccount() {
    const rows = await this.supabaseService.select<AdminAccountRow>('account.admin_accounts', {
      select: '*',
      is_active: 'eq.true',
      order: 'last_login_at.desc.nullslast,created_at.desc',
      limit: 1,
    });

    return rows[0] ?? null;
  }

  private async updateProfileRow(profileId: string, update: Partial<AdminProfile & { updatedAt: string }>) {
    const updatedProfile = await this.supabaseService.update<AccountProfileRow>(
      'account.profiles',
      { id: `eq.${profileId}` },
      this.toProfileRowUpdate(update),
    );

    if (!updatedProfile) {
      throw new BadRequestException('Admin profile could not be updated.');
    }

    const adminAccount = await this.findAdminAccount(updatedProfile.id);

    if (!adminAccount) {
      throw new NotFoundException(
        `Profile ${updatedProfile.email ?? updatedProfile.id} was updated, but it is not linked in account.admin_accounts.`,
      );
    }

    return this.toStoredProfile(updatedProfile, adminAccount);
  }

  private cleanProfileUpdate(dto: UpdateProfileDto): Partial<AdminProfile> {
    return Object.fromEntries(
      Object.entries(dto).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]),
    ) as Partial<AdminProfile>;
  }

  private toPublicProfile(profile: StoredAdminProfile): AdminProfile & { updatedAt: string } {
    const { authUserId, ...publicProfile } = profile;
    void authUserId;

    return publicProfile;
  }

  private toStoredProfile(profile: AccountProfileRow, adminAccount: AdminAccountRow): StoredAdminProfile {
    return {
      authUserId: profile.id,
      adminId: adminAccount.id,
      name: profile.full_name ?? '',
      email: profile.email ?? '',
      phone: profile.phone ?? '',
      address: [profile.address, profile.city, profile.province].filter(Boolean).join(', '),
      dob: profile.dob ?? '',
      role: 'Admin',
      lastLogin: adminAccount.last_login_at ?? '',
      profilePicture: profile.profile_picture,
      updatedAt: profile.password_updated_at ?? '',
    };
  }

  private toProfileRowUpdate(profile: Partial<AdminProfile & { updatedAt: string }>) {
    return {
      ...(profile.name !== undefined ? { full_name: profile.name } : {}),
      ...(profile.email !== undefined ? { email: profile.email } : {}),
      ...(profile.phone !== undefined ? { phone: profile.phone } : {}),
      ...(profile.address !== undefined ? { address: profile.address } : {}),
      ...(profile.dob !== undefined ? { dob: profile.dob || null } : {}),
      ...(profile.profilePicture !== undefined ? { profile_picture: profile.profilePicture } : {}),
      ...(profile.updatedAt !== undefined ? { password_updated_at: profile.updatedAt } : {}),
    };
  }
}
