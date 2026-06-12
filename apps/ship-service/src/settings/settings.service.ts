import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";
import type { SessionPayload } from "../common/session/session.types";
import { SupabaseService } from "../supabase/supabase.service";
import { SettingsRepository } from "./settings.repository";

function asBooleanRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, boolean> = {};
  for (const [key, val] of Object.entries(input)) {
    output[key] = Boolean(val);
  }
  return output;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly settingsRepository: SettingsRepository,
    private readonly supabaseService: SupabaseService,
  ) {}

  async getMySettings(session: SessionPayload) {
    const result = await this.settingsRepository.getByUserId(session.userId);
    if (result.error || !result.data) {
      throw new InternalServerErrorException("Unable to load settings.");
    }

    return {
      settings: result.data,
    };
  }

  async updateMySettings(session: SessionPayload, body: Record<string, unknown>) {
    const current = await this.settingsRepository.getByUserId(session.userId);
    if (current.error || !current.data) {
      throw new InternalServerErrorException("Unable to load settings.");
    }

    const preferencePatch = body.preferences
      ? asBooleanRecord(body.preferences)
      : null;

    if (body.preferences && !preferencePatch) {
      throw new BadRequestException("Preferences payload is invalid.");
    }

    const nextPreferences = preferencePatch
      ? {
          ...current.data.preferences,
          ...preferencePatch,
        }
      : current.data.preferences;

    const twoFactorEnabled =
      typeof body.twoFactorEnabled === "boolean"
        ? body.twoFactorEnabled
        : current.data.security.twoFactorEnabled;

    const updateResult = await this.settingsRepository.updateByUserId(session.userId, {
      preferences: nextPreferences,
      twoFactorEnabled,
    });

    if (updateResult.error || !updateResult.data) {
      throw new InternalServerErrorException("Unable to save settings.");
    }

    return {
      settings: updateResult.data,
      message: "Settings updated successfully.",
    };
  }

  async changePassword(session: SessionPayload, body: Record<string, unknown>) {
    const currentPassword = String(body.currentPassword ?? "");
    const newPassword = String(body.newPassword ?? "");
    const confirmPassword = String(body.confirmPassword ?? "");

    if (!currentPassword || !newPassword || !confirmPassword) {
      throw new BadRequestException("Current, new, and confirm password are required.");
    }

    if (newPassword !== confirmPassword) {
      throw new BadRequestException("New password and confirmation do not match.");
    }

    if (newPassword.length < 8) {
      throw new BadRequestException("Password must be at least 8 characters long.");
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException("New password must be different from the current password.");
    }

    const profileResult = await this.settingsRepository.findProfileAccessByUserId(session.userId);
    if (profileResult.error || !profileResult.data) {
      throw new InternalServerErrorException("Unable to load account information.");
    }

    const profile = this.settingsRepository.mapAccessRow(profileResult.data);
    const authClient = this.supabaseService.createServerClient();
    const verifyResult = await authClient.auth.signInWithPassword({
      email: profile.email,
      password: currentPassword,
    });

    if (verifyResult.error || !verifyResult.data.user) {
      throw new UnauthorizedException("Current password is incorrect.");
    }

    const admin = this.supabaseService.createAdminClient();
    const updateResult = await admin.auth.admin.updateUserById(session.userId, {
      password: newPassword,
    });

    await authClient.auth.signOut();

    if (updateResult.error) {
      throw new InternalServerErrorException("Unable to update password.");
    }

    const timestampResult = await this.settingsRepository.updatePasswordTimestamp(session.userId);
    if (timestampResult.error) {
      throw new InternalServerErrorException("Password updated, but timestamp could not be saved.");
    }

    return {
      message: "Password changed successfully.",
    };
  }
}
