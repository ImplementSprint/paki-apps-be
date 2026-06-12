import { Injectable, InternalServerErrorException } from '@nestjs/common';

type QueryValue = string | number | boolean | null | undefined;

@Injectable()
export class SupabaseService {
  private readonly apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  private readonly baseUrl = process.env.SUPABASE_URL;

  async select<T>(table: string, query: Record<string, QueryValue> = {}) {
    return this.request<T[]>(table, { method: 'GET', query });
  }

  async insert<T>(table: string, body: Record<string, unknown>) {
    const data = await this.request<T[]>(table, {
      method: 'POST',
      body,
      headers: { Prefer: 'return=representation' },
    });

    return data[0] ?? null;
  }

  async update<T>(table: string, query: Record<string, QueryValue>, body: Record<string, unknown>) {
    const data = await this.request<T[]>(table, {
      method: 'PATCH',
      query,
      body,
      headers: { Prefer: 'return=representation' },
    });

    return data[0] ?? null;
  }

  async signInWithPassword(email: string, password: string) {
    return this.authRequest<{ user: { id: string; email?: string } }>('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email, password },
    });
  }

  async updateAuthUserPassword(userId: string, password: string) {
    return this.authRequest<{ id: string }>(`/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      body: { password },
    });
  }

  private async request<T>(
    table: string,
    options: {
      body?: Record<string, unknown>;
      headers?: Record<string, string>;
      method: 'GET' | 'PATCH' | 'POST';
      query?: Record<string, QueryValue>;
    },
  ) {
    if (!this.baseUrl || !this.apiKey) {
      throw new InternalServerErrorException('Supabase backend environment variables are not configured.');
    }

    const { schema, tableName } = this.parseTableName(table);
    const url = new URL(`/rest/v1/${tableName}`, this.baseUrl);

    Object.entries(options.query ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url, {
      method: options.method,
      headers: {
        apikey: this.apiKey,
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(schema ? { 'Accept-Profile': schema, 'Content-Profile': schema } : {}),
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new InternalServerErrorException(`Supabase request failed: ${message || response.statusText}`);
    }

    if (response.status === 204) {
      return null as T;
    }

    return (await response.json()) as T;
  }

  private async authRequest<T>(
    path: string,
    options: {
      body: Record<string, unknown>;
      method: 'POST' | 'PUT';
    },
  ) {
    if (!this.baseUrl || !this.apiKey) {
      throw new InternalServerErrorException('Supabase backend environment variables are not configured.');
    }

    const response = await fetch(new URL(path, this.baseUrl), {
      method: options.method,
      headers: {
        apikey: this.apiKey,
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(options.body),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new InternalServerErrorException(`Supabase auth request failed: ${message || response.statusText}`);
    }

    return (await response.json()) as T;
  }

  private parseTableName(table: string) {
    const [schema, tableName] = table.includes('.') ? table.split('.', 2) : [undefined, table];

    return { schema, tableName };
  }
}
