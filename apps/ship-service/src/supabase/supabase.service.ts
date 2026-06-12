import { Injectable } from "@nestjs/common";
import { createClient } from "@supabase/supabase-js";

@Injectable()
export class SupabaseService {
  private readonly supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  private readonly supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  private readonly supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  constructor() {
    if (!this.supabaseUrl) {
      throw new Error("Missing SUPABASE_URL");
    }

    if (!this.supabaseAnonKey) {
      throw new Error("Missing SUPABASE_ANON_KEY");
    }
  }

  createServerClient() {
    return createClient(this.supabaseUrl!, this.supabaseAnonKey!);
  }

  createAdminClient() {
    if (!this.supabaseServiceRoleKey) {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
    }

    return createClient(this.supabaseUrl!, this.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
}
