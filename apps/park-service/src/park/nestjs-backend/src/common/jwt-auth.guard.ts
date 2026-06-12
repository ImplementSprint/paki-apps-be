import {
  Injectable, CanActivate, ExecutionContext,
  UnauthorizedException, ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { SupabaseService } from '../common/supabase.service';

export const ROLES_KEY = 'roles';
export const Roles  = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
export const Public = () => SetMetadata('isPublic', true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private supabase:   SupabaseService,
    private reflector:  Reflector,
    private sequelize:  Sequelize,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(), context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const authHeader: string = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) throw new UnauthorizedException('Not authorized — no token');

    const sb = this.supabase.get();
    const { data: { user: authUser }, error } = await sb.auth.getUser(token);
    if (error || !authUser) throw new UnauthorizedException('Not authorized — token invalid');

    const authId = authUser.id; // Supabase UUID

    // ── Fetch from account.profiles (no public schema) ──
    let [rows]: [any[], unknown] = await this.sequelize.query(
      `SELECT id, full_name, email, phone, role, is_verified, profile_picture
       FROM account.profiles WHERE id = :authId LIMIT 1`,
      { replacements: { authId } },
    );
    let profile = rows[0] || null;

    // Auto-provision profile on first login if missing
    if (!profile) {
      try {
        const meta  = authUser.user_metadata || {};
        const role  = authUser.app_metadata?.role || 'customer';
        const email = authUser.email || null;
        const fullName = meta.name
          || `${meta.firstName || ''} ${meta.lastName || ''}`.trim()
          || email || authId;

        await this.sequelize.query(
          `INSERT INTO account.profiles (id, full_name, email, role, is_verified, created_at)
           VALUES (:id, :fullName, :email, :role, false, now())
           ON CONFLICT (id) DO NOTHING`,
          { replacements: { id: authId, fullName, email, role } },
        );
        [rows] = await this.sequelize.query(
          `SELECT id, full_name, email, phone, role, is_verified, profile_picture
           FROM account.profiles WHERE id = :authId LIMIT 1`,
          { replacements: { authId } },
        ) as [any[], unknown];
        profile = rows[0] || null;
      } catch (e) {
        console.warn('[JwtAuthGuard] profile auto-provision failed (non-fatal):', e.message);
      }
    }

    if (!profile) throw new UnauthorizedException('User profile not found');

    // Role comes from Supabase app_metadata (authoritative) → fallback to profile.role
    const role = authUser.app_metadata?.role || profile.role || 'customer';

    req.user = {
      id:             authId,                // UUID — consistent with account.profiles PK
      authId,
      role,
      email:          profile.email,
      phone:          profile.phone,
      fullName:       profile.full_name,
      profilePicture: profile.profile_picture,
      isVerified:     profile.is_verified,
      // Aliases used by controllers
      supabaseId:     authId,
      _id:            authId,
    };

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (requiredRoles && !requiredRoles.includes(role)) {
      throw new ForbiddenException(`Access denied. Required: ${requiredRoles.join(' or ')}`);
    }

    return true;
  }
}
