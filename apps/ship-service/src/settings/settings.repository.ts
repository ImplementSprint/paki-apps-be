import { Injectable } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";
import type { UserRole } from "../common/session/session.types";
import type { SettingsRecord } from "./settings.types";

type ProfileSettingsRow = {
  id: string;
  role: UserRole;
  notification_preferences: Record<string, boolean> | null;
  two_factor_enabled: boolean | null;
};

type ProfileAccessRow = {
  id: string;
  email: string;
  role: UserRole;
};

const DEFAULT_PREFERENCES: Record<UserRole, Record<string, boolean>> = {
  customer: {
    emailNotifications: true,
    smsUpdates: false,
    autoExtend: false,
  },
  driver: {
    emailNotifications: true,
    smsAlerts: true,
    jobAlerts: true,
    navigationAudio: false,
  },
  operator: {
    emailNotifications: true,
    smsAlerts: true,
    parcelAlerts: true,
  },
};

function normalizePreferences(
  role: UserRole,
  preferences: Record<string, boolean> | null,
): Record<string, boolean> {
  return {
    ...DEFAULT_PREFERENCES[role],
    ...(preferences ?? {}),
  };
}

@Injectable()
export class SettingsRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getByUserId(userId: string) {
    const supabase = this.supabaseService.createAdminClient();
    const result = await supabase
      .schema("account")
      .from("profiles")
      .select(
        "id, role, notification_preferences, two_factor_enabled",
      )
      .eq("id", userId)
      .maybeSingle();

    return {
      data: result.data ? this.mapRow(result.data as ProfileSettingsRow) : null,
      error: result.error,
    };
  }

  async updateByUserId(
    userId: string,
    input: {
      preferences?: Record<string, boolean>;
      twoFactorEnabled?: boolean;
    },
  ) {
    const supabase = this.supabaseService.createAdminClient();
    const patch: Record<string, unknown> = {};

    if (input.preferences !== undefined) {
      patch.notification_preferences = input.preferences;
    }

    if (input.twoFactorEnabled !== undefined) {
      patch.two_factor_enabled = input.twoFactorEnabled;
    }

    const result = await supabase
      .schema("account")
      .from("profiles")
      .update(patch)
      .eq("id", userId)
      .select(
        "id, role, notification_preferences, two_factor_enabled",
      )
      .single();

    return {
      data: result.data ? this.mapRow(result.data as ProfileSettingsRow) : null,
      error: result.error,
    };
  }

  async findProfileAccessByUserId(userId: string) {
    const supabase = this.supabaseService.createAdminClient();
    return supabase
      .schema("account")
      .from("profiles")
      .select("id, email, role")
      .eq("id", userId)
      .maybeSingle();
  }

  async updatePasswordTimestamp(userId: string) {
    return { data: { id: userId }, error: null };
  }

  mapRow(row: ProfileSettingsRow): SettingsRecord {
    return {
      userId: row.id,
      preferences: normalizePreferences(row.role, row.notification_preferences),
      security: {
        twoFactorEnabled: Boolean(row.two_factor_enabled),
      },
      passwordUpdatedAt: null,
      updatedAt: null,
    };
  }

  mapAccessRow(row: ProfileAccessRow) {
    return {
      userId: row.id,
      email: row.email,
      role: row.role,
    };
  }
}
