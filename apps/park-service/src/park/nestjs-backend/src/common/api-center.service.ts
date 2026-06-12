import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import { URL } from 'url';

@Injectable()
export class ApiCenterService {
  private baseUrl: string;
  private tribeId: string;
  private secret: string;
  private timeout: number;
  private _token: string | null = null;
  private _tokenExpiresAt = 0;

  constructor(private cfg: ConfigService) {
    this.baseUrl = (cfg.get<string>('APICENTER_URL') || 'https://api-center-test.itsandbox.site').replace(/\/$/, '');
    this.tribeId = cfg.get<string>('APICENTER_TRIBE_ID') || 'pakiapps';
    this.secret = cfg.get<string>('APICENTER_TRIBE_SECRET') || '';
    this.timeout = parseInt(cfg.get<string>('APICENTER_TIMEOUT_MS') || '10000');
  }

  private _normalisePath(path: string): string {
    if (!path.startsWith('/')) path = '/' + path;
    const prefixes = ['/tribes', '/shared', '/external', '/auth', '/registry', '/health'];
    if (prefixes.some((p) => path.startsWith(p))) return '/api/v1' + path;
    return path;
  }

  private _rawRequest(method: string, path: string, body: any = null, token: string | null = null): Promise<any> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(this.baseUrl + this._normalisePath(path));
      const isHttps = parsed.protocol === 'https:';
      const transport: any = isHttps ? https : http;
      const correlationId = crypto.randomUUID();
      const bodyStr = body ? JSON.stringify(body) : null;
      const headers: any = {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
        'X-SDK-Version': '1.1.2',
        'X-SDK-Tribe-Id': this.tribeId,
      };
      if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers,
        timeout: this.timeout,
      };
      const req = transport.request(options, (res: any) => {
        let data = '';
        res.on('data', (c: any) => { data += c; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              const errorObj = parsed.error || parsed.message || parsed;
              const msg = typeof errorObj === 'object' ? JSON.stringify(errorObj) : errorObj;
              const err: any = new Error(`[ApiCenter] ${method} ${path} → ${res.statusCode}: ${msg}`);
              err.statusCode = res.statusCode;
              return reject(err);
            }
            resolve(parsed);
          } catch {
            if (res.statusCode >= 400) {
              const err: any = new Error(`[ApiCenter] HTTP ${res.statusCode}`);
              err.statusCode = res.statusCode;
              return reject(err);
            }
            resolve({ raw: data });
          }
        });
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('[ApiCenter] Request timed out')); });
      req.on('error', reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  private async _request(method: string, path: string, body: any = null, token: string | null = null): Promise<any> {
    let attempt = 0; let delay = 600;
    while (attempt < 5) {
      try { return await this._rawRequest(method, path, body, token); }
      catch (err: any) {
        attempt++;
        const isRL = err.statusCode === 429 || (err.statusCode === 502 && err.message?.includes('rate'));
        if (isRL && attempt < 5) {
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2;
        } else throw err;
      }
    }
  }

  async getToken(): Promise<string> {
    if (this._token && Date.now() < this._tokenExpiresAt - 30_000) return this._token;
    const res = await this._rawRequest('POST', '/auth/token', { tribeId: this.tribeId, secret: this.secret }, null);
    const d = res.data || res;
    this._token = (d.accessToken || d.token || d.access_token) as string;
    const ttl = (d.expiresIn || d.expires_in || 3600) * 1000;
    this._tokenExpiresAt = Date.now() + ttl;
    return this._token;
  }

  async get(path: string): Promise<any> {
    const token = await this.getToken();
    return this._request('GET', path, null, token);
  }

  async post(path: string, body: any): Promise<any> {
    const token = await this.getToken();
    return this._request('POST', path, body, token);
  }

  async ping(): Promise<boolean> {
    try { await this._rawRequest('GET', '/health', null, null); return true; } catch { return false; }
  }
}
