import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Sequelize } from 'sequelize-typescript';
import { SupabaseService } from '../common/supabase.service';
import { SmsService } from '../sms/sms.service';

/**
 * AuthService — all user identity lives in account.profiles (UUID PK).
 * NO public schema is used here.
 */
@Injectable()
export class AuthService {
  constructor(
    private supabaseSvc: SupabaseService,
    private cfg:         ConfigService,
    private smsSvc:      SmsService,
    private sequelize:   Sequelize,
  ) {}

  private sb() { return this.supabaseSvc.get(); }

  private phoneToSyntheticEmail(phone: string): string {
    const digits = String(phone).replace(/\D/g, '');
    return `${digits}@phone.pakipark.local`;
  }
  private isPhoneIdentifier(val: string): boolean {
    return /^(\+63|0)\d{10}$/.test(val.replace(/\s/g, ''));
  }

  // ── account.profiles helpers ──────────────────────────────────────────────

  /** Upsert account.profiles row (auth UUID is the PK) */
  private async upsertProfile(authId: string, data: {
    fullName?: string; firstName?: string; lastName?: string;
    email?: string | null; phone?: string | null;
    dob?: string | null; role?: string; isVerified?: boolean;
  }) {
    const fullName = data.fullName
      || `${data.firstName || ''} ${data.lastName || ''}`.trim()
      || data.email
      || authId;
    await this.sequelize.query(
      `INSERT INTO account.profiles (id, full_name, email, phone, dob, role, is_verified, created_at)
       VALUES (:id, :fullName, :email, :phone, :dob, :role, :isVerified, now())
       ON CONFLICT (id) DO UPDATE
         SET full_name   = COALESCE(EXCLUDED.full_name,   account.profiles.full_name),
             email       = COALESCE(EXCLUDED.email,       account.profiles.email),
             phone       = COALESCE(EXCLUDED.phone,       account.profiles.phone),
             dob         = COALESCE(EXCLUDED.dob,         account.profiles.dob),
             role        = COALESCE(EXCLUDED.role,        account.profiles.role),
             is_verified = COALESCE(EXCLUDED.is_verified, account.profiles.is_verified)`,
      { replacements: {
          id:         authId,
          fullName:   fullName || null,
          email:      data.email      ?? null,
          phone:      data.phone      ?? null,
          dob:        data.dob        ?? null,
          role:       data.role       || 'customer',
          isVerified: data.isVerified ?? false,
        } },
    );
  }

  /** Also upsert admin accounts table for non-customer roles */
  private async upsertAdminAccount(authId: string, role: string) {
    if (!['admin', 'teller', 'business_partner'].includes(role)) return;
    await this.sequelize.query(
      `INSERT INTO account.admin_accounts (profile_id, admin_role, is_active, created_at)
       VALUES (:profileId, :role, true, now())
       ON CONFLICT (profile_id) DO UPDATE
         SET admin_role = EXCLUDED.admin_role, is_active = true`,
      { replacements: { profileId: authId, role } },
    ).catch((e) => console.warn('[Auth] admin_accounts upsert (non-fatal):', e.message));
  }

  private async getProfile(authId: string): Promise<any> {
    const [rows]: [any[], unknown] = await this.sequelize.query(
      `SELECT ap.id AS auth_id, ap.full_name, ap.email, ap.phone, ap.dob, ap.role,
              ap.is_verified, ap.profile_picture,
              aa.admin_role, aa.permissions
       FROM account.profiles ap
       LEFT JOIN account.admin_accounts aa ON aa.profile_id = ap.id
       WHERE ap.id = :authId LIMIT 1`,
      { replacements: { authId } },
    );
    return rows[0] || null;
  }

  private async getProfileByEmail(email: string): Promise<any> {
    const [rows]: [any[], unknown] = await this.sequelize.query(
      `SELECT id AS auth_id, full_name, email, phone, dob, role, is_verified, profile_picture
       FROM account.profiles WHERE email = :email LIMIT 1`,
      { replacements: { email } },
    );
    return rows[0] || null;
  }

  private async getProfileByPhone(phone: string): Promise<any> {
    const [rows]: [any[], unknown] = await this.sequelize.query(
      `SELECT id AS auth_id, full_name, email, phone, dob, role, is_verified, profile_picture
       FROM account.profiles WHERE phone = :phone LIMIT 1`,
      { replacements: { phone } },
    );
    return rows[0] || null;
  }

  private buildResponse(profile: any, authId: string, session: any) {
    const fullName  = (profile.full_name || '').trim();
    const parts     = fullName.split(/\s+/);
    let firstName   = '';
    let lastName    = '';
    if (parts.length > 1) {
      lastName  = parts[parts.length - 1];
      firstName = parts.slice(0, -1).join(' ');
    } else {
      firstName = parts[0] || '';
      lastName  = '';
    }
    const isSynth   = profile.email?.includes('@phone.pakipark.local');
    const displayEmail = isSynth ? null : (profile.email || null);
    return {
      _id:            authId,
      authId,
      firstName, lastName,
      name:           fullName,
      email:          displayEmail,
      phone:          profile.phone || null,
      identifier:     profile.phone || displayEmail,
      dob:            profile.dob            || null,
      role:           profile.admin_role     || profile.role || 'customer',
      profilePicture: profile.profile_picture || null,
      isVerified:     profile.is_verified    || false,
      token:          session.access_token,
      refreshToken:   session.refresh_token,
      expiresAt:      session.expires_at,
    };
  }

  // ── Public Methods ────────────────────────────────────────────────────────

  async registerCustomer(data: any): Promise<any> {
    const { firstName, lastName, email, phone, password, dob } = data;
    const sb = this.sb();
    const isPhoneReg = !!phone && !email;
    const canonical  = phone ? this.smsSvc.normPhone(phone) : null;
    const authEmail  = isPhoneReg ? this.phoneToSyntheticEmail(canonical) : email;
    if (!authEmail) throw new Error('Email or phone number is required.');

    // Duplicate check via account.profiles
    if (canonical) {
      const dup = await this.getProfileByPhone(canonical);
      if (dup) throw new Error('This phone number is already registered. Please log in.');
    }
    if (!isPhoneReg && email) {
      const dup = await this.getProfileByEmail(email);
      if (dup) throw new Error('This email is already registered. Please log in.');
    }

    // Combine input into a trimmed full name string
    const fullName = `${data.firstName} ${data.lastName}`.trim();

    const { data: authData, error: authError } = await sb.auth.admin.createUser({
      email: authEmail, password, email_confirm: true,
      app_metadata:  { role: 'customer' },
      user_metadata: { firstName, lastName, name: fullName, phone: canonical },
    });
    if (authError) throw new Error(authError.message);

    const authUser = authData.user;
    // Insert the single string into your database
    await this.upsertProfile(authUser.id, {
      fullName,
      firstName, lastName,
      email:      isPhoneReg ? null : email,
      phone:      canonical,
      dob,
      role:       'customer',
      isVerified: false,
    });

    const { data: session, error: signInError } = await sb.auth.signInWithPassword({ email: authEmail, password });
    if (signInError) throw new Error(signInError.message);

    const profile = await this.getProfile(authUser.id);
    return this.buildResponse(profile, authUser.id, session.session);
  }

  async registerAdmin(data: any): Promise<any> {
    const { firstName, lastName, email, phone, password, accessCode, role: requestedRole } = data;
    if (accessCode !== (this.cfg.get('ADMIN_ACCESS_CODE') || ''))
      throw new Error('Invalid admin access code');
    const finalRole = ['admin', 'teller', 'business_partner'].includes(requestedRole)
      ? requestedRole : 'admin';
    const sb = this.sb();

    // Combine input into a trimmed full name string
    const fullName = `${data.firstName} ${data.lastName}`.trim();

    const { data: authData, error: authError } = await sb.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata:  { role: finalRole },
      user_metadata: { firstName, lastName, name: fullName, phone },
    });
    if (authError) throw new Error(authError.message);

    const authUser = authData.user;
    // Insert the single string into your database
    await this.upsertProfile(authUser.id, { fullName, firstName, lastName, email, phone, role: finalRole, isVerified: true });
    await this.upsertAdminAccount(authUser.id, finalRole);

    const { data: session, error: signInError } = await sb.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(signInError.message);

    const profile = await this.getProfile(authUser.id);
    return this.buildResponse(profile, authUser.id, session.session);
  }

  async loginUser(data: any): Promise<any> {
    const { email: identifier, password } = data;
    const sb = this.sb();

    let authEmail = identifier;
    if (this.isPhoneIdentifier(identifier)) {
      const canonical = this.smsSvc.normPhone(identifier);
      const profile = await this.getProfileByPhone(canonical);
      if (!profile) throw new Error('No account found with this phone number.');
      authEmail = profile.email || this.phoneToSyntheticEmail(canonical);
    }

    const { data: session, error } = await sb.auth.signInWithPassword({ email: authEmail, password });
    if (error) throw new Error('Invalid credentials. Please check your email/phone and password.');

    const authUser = session.user;
    let profile = await this.getProfile(authUser.id);

    // Auto-provision on first-ever login
    if (!profile) {
      const meta = authUser.user_metadata || {};
      const nameParts = (meta.name || '').trim().split(/\s+/);
      let fName = meta.firstName || '';
      let lName = meta.lastName || '';
      if (!fName && !lName && nameParts.length > 0) {
        if (nameParts.length > 1) {
          lName = nameParts[nameParts.length - 1];
          fName = nameParts.slice(0, -1).join(' ');
        } else {
          fName = nameParts[0] || '';
          lName = '';
        }
      }
      const role  = authUser.app_metadata?.role || 'customer';
      const realEmail = authUser.email?.includes('@phone.pakipark.local') ? null : authUser.email;
      await this.upsertProfile(authUser.id, {
        firstName: fName,
        lastName: lName,
        email: realEmail,
        phone: meta.phone,
        role,
        isVerified: role !== 'customer' // customer starts unverified!
      });
      if (['admin', 'teller', 'business_partner'].includes(role))
        await this.upsertAdminAccount(authUser.id, role);
      profile = await this.getProfile(authUser.id);
    }

    if (!profile) throw new Error('Failed to load profile. Please contact support.');

    // Enforce authoritative role from Supabase app_metadata
    const role = authUser.app_metadata?.role || profile.role || 'customer';
    return this.buildResponse({ ...profile, role }, authUser.id, session.session);
  }

  async refreshToken(data: any): Promise<any> {
    const { refreshToken } = data;
    const { data: d, error } = await this.sb().auth.refreshSession({ refresh_token: refreshToken });
    if (error) throw new Error('Invalid or expired refresh token');
    return { token: d.session.access_token, refreshToken: d.session.refresh_token, expiresAt: d.session.expires_at };
  }

  async logoutUser(_data: any): Promise<any> {
    return { success: true };
  }

  async findUserByIdentifier(identifier: string): Promise<any> {
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    if (isEmail) return this.getProfileByEmail(identifier.trim().toLowerCase());
    return this.getProfileByPhone(this.smsSvc.normPhone(identifier));
  }

  isEmailIdentifier(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  async checkIdentifier(value: string): Promise<boolean> {
    const isPhone = !value.includes('@');
    const profile = isPhone
      ? await this.getProfileByPhone(this.smsSvc.normPhone(value))
      : await this.getProfileByEmail(value.trim().toLowerCase());
    return !profile; // true = available
  }
}
