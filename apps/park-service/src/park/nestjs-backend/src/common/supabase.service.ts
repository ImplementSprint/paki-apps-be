import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private client: SupabaseClient;

  constructor(private cfg: ConfigService) {
    const url = cfg.get<string>('SUPABASE_URL') || '';
    const key = cfg.get<string>('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!url || !key) console.warn('⚠️  Supabase URL or Service Role Key missing');
    this.client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  get(): SupabaseClient {
    return this.client;
  }

  /** Upload a file buffer to a Supabase Storage bucket */
  async uploadFile(bucket: string, filePath: string, buffer: Buffer, contentType: string): Promise<string> {
    const { error } = await this.client.storage.from(bucket).upload(filePath, buffer, { contentType, upsert: true });
    if (error) throw new Error(`Supabase Storage Upload Error: ${error.message}`);
    const { data: { publicUrl } } = this.client.storage.from(bucket).getPublicUrl(filePath);
    return publicUrl;
  }

  /** Delete a file from a Supabase Storage bucket */
  async deleteFile(bucket: string, filePath: string): Promise<void> {
    const { error } = await this.client.storage.from(bucket).remove([filePath]);
    if (error) throw new Error(`Supabase Storage Delete Error: ${error.message}`);
  }
}
