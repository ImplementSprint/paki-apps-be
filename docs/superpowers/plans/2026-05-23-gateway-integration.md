# Gateway Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the standalone `gateway` repository into `pakiapps-be` as `apps/gateway`, conforming to the monorepo's conventions and extracting shared code to `libs/`.

**Architecture:** Direct lift-and-shift — gateway source moves to `apps/gateway/src/`, shared concerns (`LoggingModule`, session types, session utilities) move to `libs/common/`, and `logActivity` plus gateway compatibility methods are added to `libs/supabase/`. The gateway's own `SupabaseModule` is replaced by `@app/supabase`. All `process.env` direct reads in gateway services are replaced with `ConfigService` injection.

**Tech Stack:** NestJS 11, TypeScript 5.7, Supabase JS v2, ioredis, @nestjs/throttler, http-proxy-middleware, @implementsprint/sdk (TribeClient), Jest 29

---

## File Map

**Created:**
- `apps/gateway/tsconfig.app.json`
- `apps/gateway/Dockerfile`
- `apps/gateway/src/main.ts`
- `apps/gateway/src/app.module.ts`
- `apps/gateway/src/auth/auth.module.ts`
- `apps/gateway/src/auth/auth.controller.ts`
- `apps/gateway/src/auth/auth.service.ts`
- `apps/gateway/src/auth/auth.controller.spec.ts`
- `apps/gateway/src/auth/auth.service.spec.ts`
- `apps/gateway/src/auth/two-factor.util.ts`
- `apps/gateway/src/common/interceptors/idempotency.interceptor.ts`
- `apps/gateway/src/gateway/gateway.module.ts`
- `apps/gateway/src/notifications/notifications.controller.ts`
- `apps/gateway/src/notifications/notifications.controller.spec.ts`
- `apps/gateway/src/notifications/notifications.module.ts`
- `apps/gateway/src/notifications/notifications.repository.ts`
- `apps/gateway/src/notifications/notifications.service.ts`
- `apps/gateway/src/notifications/notifications.service.spec.ts`
- `apps/gateway/src/notifications/notifications.types.ts`
- `apps/gateway/src/payment/payment.controller.ts`
- `apps/gateway/src/payment/payment.controller.spec.ts`
- `apps/gateway/src/payment/payment.module.ts`
- `apps/gateway/src/payment/payment.service.ts`
- `apps/gateway/src/payment/payment.service.spec.ts`
- `libs/common/src/session/session.types.ts`
- `libs/common/src/session/session.util.ts`
- `libs/common/src/session/session-auth.guard.ts`
- `libs/common/src/session/session-auth.guard.spec.ts`
- `libs/common/src/logging/logging.module.ts`

**Modified:**
- `nest-cli.json`
- `package.json`
- `libs/common/src/index.ts`
- `libs/supabase/src/supabase.service.ts`
- `libs/supabase/src/supabase.service.spec.ts`
- `.env.example`

---

## Task 1: Monorepo scaffolding

**Files:**
- Modify: `nest-cli.json`
- Create: `apps/gateway/tsconfig.app.json`
- Modify: `package.json` (scripts only — deps come in Task 2)
- Create: `apps/gateway/Dockerfile`

- [ ] **Step 1: Add gateway project to `nest-cli.json`**

Open `nest-cli.json` and add a `"gateway"` entry inside `"projects"`:

```json
"gateway": {
  "type": "application",
  "root": "apps/gateway",
  "entryFile": "main",
  "sourceRoot": "apps/gateway/src",
  "compilerOptions": {
    "tsConfigPath": "apps/gateway/tsconfig.app.json"
  }
}
```

- [ ] **Step 2: Create `apps/gateway/tsconfig.app.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "declaration": false,
    "outDir": "../../dist/apps/gateway"
  },
  "include": ["src/**/*.ts", "../../libs/**/*.ts"],
  "exclude": ["node_modules", "dist", "test", "**/*.spec.ts"]
}
```

- [ ] **Step 3: Add scripts to root `package.json`**

Inside the `"scripts"` block, add after the `location-service` entries:

```json
"build:gateway": "nest build gateway",
"start:gateway": "nest start gateway",
"start:gateway:dev": "nest start gateway --watch",
"start:prod:gateway": "node dist/apps/gateway/main",
"test:gateway": "jest --selectProjects gateway"
```

- [ ] **Step 4: Create `apps/gateway/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json .npmrc ./
RUN --mount=type=secret,id=GITHUB_TOKEN \
  GITHUB_TOKEN="$(cat /run/secrets/GITHUB_TOKEN)" npm ci

COPY tsconfig*.json nest-cli.json ./
COPY apps ./apps
COPY libs ./libs

RUN npm run build:gateway

FROM node:22-alpine AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json .npmrc ./
RUN --mount=type=secret,id=GITHUB_TOKEN \
  apk upgrade --no-cache zlib \
  && GITHUB_TOKEN="$(cat /run/secrets/GITHUB_TOKEN)" npm ci --omit=dev \
  && rm .npmrc package-lock.json \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nestjs

COPY --chown=nestjs:nodejs --from=builder /app/dist ./dist

USER nestjs

EXPOSE 3005

CMD ["node", "dist/apps/gateway/main"]
```

- [ ] **Step 5: Commit**

```bash
git add nest-cli.json apps/gateway/tsconfig.app.json apps/gateway/Dockerfile package.json
git commit -m "chore: scaffold gateway app in monorepo (nest-cli, tsconfig, dockerfile, scripts)"
```

---

## Task 2: Install new dependencies

**Files:**
- Modify: `package.json` (dependencies)

- [ ] **Step 1: Add dependencies to root `package.json`**

In the `"dependencies"` block, add:

```json
"@nest-lab/throttler-storage-redis": "^1.2.0",
"@nestjs/throttler": "^6.5.0",
"@nestjs/axios": "^4.0.1",
"http-proxy-middleware": "^4.0.0",
"ioredis": "^5.10.1"
```

In the `"devDependencies"` block, add:

```json
"@types/ioredis": "^4.28.10"
```

- [ ] **Step 2: Install**

```bash
npm install
```

Expected: resolves without errors. `package-lock.json` is updated.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add gateway dependencies (throttler, redis, http-proxy-middleware)"
```

---

## Task 3: Extend `libs/supabase` — add `logActivity` and gateway compatibility methods

The monorepo's `SupabaseService` uses `getClient()` internally, but the gateway code calls `createAdminClient()` and `createServerClient()`. Add those aliases plus `logActivity` so gateway code works without modification.

**Files:**
- Modify: `libs/supabase/src/supabase.service.ts`
- Modify: `libs/supabase/src/supabase.service.spec.ts`

- [ ] **Step 1: Write failing tests in `libs/supabase/src/supabase.service.spec.ts`**

Add a new `describe` block at the bottom of the existing test file (before the final closing `}`):

```ts
describe('logActivity()', () => {
  it('inserts an audit log row with the resolved full name', async () => {
    const service = await createService(
      'https://abc.supabase.co',
      'service-role-key',
    );

    const mockInsert = jest.fn().mockResolvedValue({ error: null });
    const mockFrom = jest.fn().mockReturnValue({ insert: mockInsert });
    const mockSchema = jest.fn().mockReturnValue({ from: mockFrom });
    const mockSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: { full_name: 'Jane Doe' },
        }),
      }),
    });
    const mockProfileFrom = jest.fn().mockReturnValue({ select: mockSelect });

    setInternalClient(service, {
      auth: { admin: { listUsers: jest.fn().mockResolvedValue({ error: null }) } },
      schema: jest.fn().mockImplementation((schema: string) => ({
        from: schema === 'account' ? mockProfileFrom() : mockFrom(),
      })),
    } as any);

    await service.logActivity(
      'user-123',
      'USER_LOGIN',
      'User',
      'user-123',
      (name) => `${name} logged in`,
    );

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-123',
        action: 'USER_LOGIN',
        entity_type: 'User',
        entity_id: 'user-123',
        description: 'Jane Doe logged in',
      }),
    );
  });

  it('does not throw when the admin client is null', async () => {
    const service = await createService(undefined, undefined);
    await expect(
      service.logActivity('u', 'ACTION', 'Entity', 'e', () => 'desc'),
    ).resolves.not.toThrow();
  });
});

describe('createAdminClient()', () => {
  it('returns the initialized client', async () => {
    const service = await createService(
      'https://abc.supabase.co',
      'service-role-key',
    );
    expect(service.createAdminClient()).not.toBeNull();
  });

  it('throws InternalServerErrorException when client is null', async () => {
    const service = await createService(undefined, undefined);
    expect(() => service.createAdminClient()).toThrow();
  });
});

describe('createServerClient()', () => {
  it('returns a client when SUPABASE_URL and SUPABASE_ANON_KEY are set', async () => {
    const service = await createService(
      'https://abc.supabase.co',
      'service-role-key',
    );
    // Stub ConfigService.get to also return the anon key
    (service as any).configService = {
      get: (key: string) => {
        if (key === 'SUPABASE_URL') return 'https://abc.supabase.co';
        if (key === 'SUPABASE_ANON_KEY') return 'anon-key';
        return undefined;
      },
    };
    expect(service.createServerClient()).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:api -- --testPathPattern="supabase.service"
```

Expected: FAIL — `logActivity`, `createAdminClient`, `createServerClient` are not defined.

- [ ] **Step 3: Add methods to `libs/supabase/src/supabase.service.ts`**

Add an import for `InternalServerErrorException` (it's already imported from `@nestjs/common` — check; if not, add it). Then append these methods before the final closing `}` of the `SupabaseService` class:

```ts
createAdminClient(): SupabaseClient {
  const client = this.getClient();
  if (!client) {
    throw new InternalServerErrorException(
      'Supabase admin client is not available. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  return client;
}

createServerClient(): SupabaseClient {
  const url = this.configService.get<string>('SUPABASE_URL')?.trim();
  const anonKey = this.configService.get<string>('SUPABASE_ANON_KEY')?.trim();

  if (!url || !anonKey) {
    throw new InternalServerErrorException(
      'Supabase server client is not available. Check SUPABASE_URL and SUPABASE_ANON_KEY.',
    );
  }

  return this.buildClient(url, anonKey);
}

async logActivity(
  userId: string,
  actionType: string,
  entityType: string,
  entityId: string,
  descriptionFn: (name: string) => string,
): Promise<void> {
  try {
    const admin = this.createAdminClient();

    const { data } = await admin
      .schema('account')
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .single();

    const fullName = (data as { full_name?: string } | null)?.full_name ?? 'Unknown User';

    await admin.schema('public').from('audit_logs').insert({
      user_id: userId,
      action: actionType,
      entity_type: entityType,
      entity_id: entityId,
      description: descriptionFn(fullName),
    });
  } catch (error) {
    this.logger.error('Failed to log activity', error);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:api -- --testPathPattern="supabase.service"
```

Expected: PASS (the `logActivity` null-client test passes because `createAdminClient` throws and the catch block swallows it; the insert test passes with the stubbed client).

- [ ] **Step 5: Commit**

```bash
git add libs/supabase/src/supabase.service.ts libs/supabase/src/supabase.service.spec.ts
git commit -m "feat(supabase): add logActivity, createAdminClient, createServerClient to SupabaseService"
```

---

## Task 4: Add session types, session utilities, and `LoggingModule` to `libs/common`

**Files:**
- Create: `libs/common/src/session/session.types.ts`
- Create: `libs/common/src/session/session.util.ts`
- Create: `libs/common/src/session/session-auth.guard.ts`
- Create: `libs/common/src/session/session-auth.guard.spec.ts`
- Create: `libs/common/src/logging/logging.module.ts`
- Modify: `libs/common/src/index.ts`

- [ ] **Step 1: Write failing test for `SessionAuthGuard` in `libs/common/src/session/session-auth.guard.spec.ts`**

```ts
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SessionAuthGuard } from './session-auth.guard';
import { createSessionToken, SESSION_COOKIE } from './session.util';

function makeContext(cookieHeader?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { cookie: cookieHeader }, user: undefined }),
    }),
  } as unknown as ExecutionContext;
}

describe('SessionAuthGuard', () => {
  let guard: SessionAuthGuard;

  beforeEach(() => {
    guard = new SessionAuthGuard();
  });

  it('throws UnauthorizedException when no cookie is present', () => {
    expect(() => guard.canActivate(makeContext())).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when cookie value is not a valid session token', () => {
    const ctx = makeContext(`${SESSION_COOKIE}=not-valid-base64!!!`);
    expect(() => guard.canActivate(makeContext(`${SESSION_COOKIE}=garbage`))).toThrow(
      UnauthorizedException,
    );
  });

  it('returns true and attaches session to request when cookie is valid', () => {
    const payload = { userId: 'u1', role: 'customer', fullName: 'Alice' };
    const token = createSessionToken(payload);
    const request: any = { headers: { cookie: `${SESSION_COOKIE}=${token}` } };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(request.user).toEqual(payload);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:api -- --testPathPattern="session-auth.guard"
```

Expected: FAIL — `session-auth.guard` module not found.

- [ ] **Step 3: Create `libs/common/src/session/session.types.ts`**

```ts
export type UserRole = 'customer' | 'driver' | 'operator' | 'parcel_sender';

export type SessionPayload = {
  userId: string;
  role: UserRole;
  fullName: string;
};
```

- [ ] **Step 4: Create `libs/common/src/session/session.util.ts`**

```ts
import type { CookieOptions } from 'express';

export const SESSION_COOKIE = 'pakiapps_session';

export function createSessionToken(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

export function readSessionToken(token: string | undefined): unknown {
  if (!token) return null;
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

export function getSessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

export function parseCookieHeader(
  cookieString: string | undefined | null,
): Record<string, string> {
  if (!cookieString) return {};
  return cookieString.split(';').reduce<Record<string, string>>((cookies, item) => {
    const [key, ...valueParts] = item.trim().split('=');
    if (key) {
      cookies[key] = valueParts.join('=');
    }
    return cookies;
  }, {});
}
```

- [ ] **Step 5: Create `libs/common/src/session/session-auth.guard.ts`**

```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { parseCookieHeader, readSessionToken, SESSION_COOKIE } from './session.util';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const cookies = parseCookieHeader(request['headers'] as any);
    const session = readSessionToken(cookies[SESSION_COOKIE]);

    if (!session) {
      throw new UnauthorizedException(
        'You must be logged in to access this resource.',
      );
    }

    request['user'] = session;
    return true;
  }
}
```

- [ ] **Step 6: Create `libs/common/src/logging/logging.module.ts`**

```ts
import { Module } from '@nestjs/common';

@Module({})
export class LoggingModule {}
```

- [ ] **Step 7: Run test to verify it passes**

```bash
npm run test:api -- --testPathPattern="session-auth.guard"
```

Expected: PASS (3 tests).

- [ ] **Step 8: Update `libs/common/src/index.ts`**

Add these exports at the end of the file:

```ts
export * from './session/session.types';
export * from './session/session.util';
export * from './session/session-auth.guard';
export * from './logging/logging.module';
```

- [ ] **Step 9: Commit**

```bash
git add libs/common/src/session libs/common/src/logging libs/common/src/index.ts
git commit -m "feat(common): add session types, session utilities, SessionAuthGuard, LoggingModule"
```

---

## Task 5: Scaffold `apps/gateway` — copy unchanged files

Copy gateway source files that need no structural changes (only import path updates, handled in later tasks). Create the directory structure and write these files verbatim from the gateway repo.

**Files:**
- Create: `apps/gateway/src/auth/two-factor.util.ts`
- Create: `apps/gateway/src/notifications/notifications.types.ts`
- Create: `apps/gateway/src/notifications/notifications.service.ts`
- Create: `apps/gateway/src/notifications/notifications.service.spec.ts`
- Create: `apps/gateway/src/notifications/notifications.controller.spec.ts`
- Create: `apps/gateway/src/payment/payment.service.spec.ts`
- Create: `apps/gateway/src/payment/payment.controller.spec.ts`
- Create: `apps/gateway/src/auth/auth.controller.spec.ts`

- [ ] **Step 1: Create `apps/gateway/src/auth/two-factor.util.ts`**

Copy verbatim from `C:\Users\jmper\Documents\gateway\src\auth\two-factor.util.ts` — no changes needed.

- [ ] **Step 2: Create `apps/gateway/src/notifications/notifications.types.ts`**

```ts
export type NotificationType = 'delivery' | 'system' | 'promo';

export type UserNotification = {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string | null;
};
```

- [ ] **Step 3: Create `apps/gateway/src/notifications/notifications.service.ts`**

Copy verbatim from `C:\Users\jmper\Documents\gateway\src\notifications\notifications.service.ts` — no import path changes needed (it only imports from `../common/session/session.types` which will be resolved via its own controller; the service itself only imports from `./notifications.repository` and `./notifications.types`).

- [ ] **Step 4: Create `apps/gateway/src/notifications/notifications.service.spec.ts`**

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: NotificationsRepository,
          useValue: {
            listByUserId: jest.fn().mockResolvedValue({ data: [], error: null }),
            create: jest.fn(),
            markOneAsRead: jest.fn(),
            markAllAsRead: jest.fn(),
            deleteOne: jest.fn(),
            deleteAll: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

- [ ] **Step 5: Create `apps/gateway/src/notifications/notifications.controller.spec.ts`**

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  let controller: NotificationsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationsService,
          useValue: {
            listForUser: jest.fn(),
            createForUser: jest.fn(),
            markAsRead: jest.fn(),
            markAllAsRead: jest.fn(),
            deleteOne: jest.fn(),
            clearAll: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
```

- [ ] **Step 6: Create `apps/gateway/src/payment/payment.service.spec.ts`**

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PaymentService } from './payment.service';

describe('PaymentService', () => {
  let service: PaymentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-value'),
          },
        },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

- [ ] **Step 7: Create `apps/gateway/src/payment/payment.controller.spec.ts`**

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';

describe('PaymentController', () => {
  let controller: PaymentController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [
        {
          provide: PaymentService,
          useValue: { processCheckout: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<PaymentController>(PaymentController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
```

- [ ] **Step 8: Create `apps/gateway/src/auth/auth.controller.spec.ts`**

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            signIn: jest.fn(),
            createUser: jest.fn(),
            sendPasswordReset: jest.fn(),
            resetPasswordWithOtp: jest.fn(),
            changePassword: jest.fn(),
            setupTwoFactor: jest.fn(),
            enableTwoFactor: jest.fn(),
            disableTwoFactor: jest.fn(),
            verifyTwoFactorLogin: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
```

- [ ] **Step 9: Commit**

```bash
git add apps/gateway/src/auth/two-factor.util.ts apps/gateway/src/notifications apps/gateway/src/payment/payment.service.spec.ts apps/gateway/src/payment/payment.controller.spec.ts apps/gateway/src/auth/auth.controller.spec.ts
git commit -m "feat(gateway): scaffold gateway app source files (unchanged files)"
```

---

## Task 6: Write `apps/gateway/src/main.ts` and `apps/gateway/src/app.module.ts`

**Files:**
- Create: `apps/gateway/src/main.ts`
- Create: `apps/gateway/src/app.module.ts`

- [ ] **Step 1: Create `apps/gateway/src/main.ts`**

```ts
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AllExceptionsFilter,
  BODY_SIZE_LIMIT,
  corsOptions,
  helmetConfig,
} from '@app/common';
import * as express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  const configService = app.get(ConfigService);

  app.use(helmet(helmetConfig));
  app.use(express.json({ limit: BODY_SIZE_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_SIZE_LIMIT }));
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1');

  const allowedOriginsEnv = configService.get<string>('ALLOWED_ORIGINS');
  app.enableCors(corsOptions(allowedOriginsEnv));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const port = configService.get<number>('PORT') ?? 3005;
  await app.listen(port, '0.0.0.0');
  logger.log(`Gateway running on 0.0.0.0:${String(port)}`);
}

void bootstrap();
```

- [ ] **Step 2: Create `apps/gateway/src/app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { APP_GUARD } from '@nestjs/core';
import Redis from 'ioredis';

import { SupabaseModule } from '@app/supabase';
import { LoggingModule } from '@app/common';

import { AuthModule } from './auth/auth.module';
import { GatewayModule } from './gateway/gateway.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentModule } from './payment/payment.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [{ ttl: 60000, limit: 100 }],
        storage: new ThrottlerStorageRedisService(
          new Redis({
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
          }),
        ),
      }),
    }),

    SupabaseModule,
    LoggingModule,
    AuthModule,
    GatewayModule,
    NotificationsModule,
    PaymentModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Commit**

```bash
git add apps/gateway/src/main.ts apps/gateway/src/app.module.ts
git commit -m "feat(gateway): add main.ts and app.module.ts conforming to monorepo conventions"
```

---

## Task 7: Write `apps/gateway/src/auth/` module files

`AuthService` gets `ConfigService` injection (replacing `process.env`), uses `SupabaseService` from `@app/supabase`, and imports session types from `@app/common`. `AuthController` imports session utils from `@app/common`.

**Files:**
- Create: `apps/gateway/src/auth/auth.service.ts`
- Create: `apps/gateway/src/auth/auth.service.spec.ts`
- Create: `apps/gateway/src/auth/auth.controller.ts`
- Create: `apps/gateway/src/auth/auth.module.ts`

- [ ] **Step 1: Create `apps/gateway/src/auth/auth.service.spec.ts`**

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { SupabaseService } from '@app/supabase';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: SupabaseService,
          useValue: {
            createAdminClient: jest.fn(),
            createServerClient: jest.fn(),
            logActivity: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-value'),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:gateway -- --testPathPattern="auth.service"
```

Expected: FAIL — gateway jest project not configured yet (will be added in Task 13), so run with api project for now:

```bash
npm run test:api -- --testPathPattern="apps/gateway/src/auth/auth.service"
```

Expected: FAIL — `auth.service` module not found.

- [ ] **Step 3: Create `apps/gateway/src/auth/auth.service.ts`**

Copy the full content from `C:\Users\jmper\Documents\gateway\src\auth\auth.service.ts`, then make these three changes:

**Change 1** — replace the import block at the top:

```ts
// REMOVE:
import { SupabaseService } from "../supabase/supabase.service";
import type { SessionPayload, UserRole } from "../common/session/session.types";

// ADD:
import { SupabaseService } from '@app/supabase';
import type { SessionPayload, UserRole } from '@app/common';
```

**Change 2** — replace the constructor:

```ts
// REMOVE:
constructor(private readonly supabaseService: SupabaseService) {
  this.tribeClient = new TribeClient({
    gatewayUrl: process.env.APICENTER_URL || "https://api-center-test.itsandbox.site",
    tribeId: process.env.APICENTER_TRIBE_ID || "pakiapps",
    secret: process.env.APICENTER_TRIBE_SECRET || "",
  });
}

// ADD:
constructor(
  private readonly supabaseService: SupabaseService,
  private readonly configService: ConfigService,
) {
  this.tribeClient = new TribeClient({
    gatewayUrl: configService.get<string>('APICENTER_URL', 'https://api-center-test.itsandbox.site'),
    tribeId: configService.get<string>('APICENTER_TRIBE_ID', 'pakiapps'),
    secret: configService.get<string>('APICENTER_TRIBE_SECRET', ''),
  });
}
```

**Change 3** — add `ConfigService` to the import from `@nestjs/config` at the top:

```ts
import { ConfigService } from '@nestjs/config';
```

- [ ] **Step 4: Create `apps/gateway/src/auth/auth.controller.ts`**

Copy the full content from `C:\Users\jmper\Documents\gateway\src\auth\auth.controller.ts`, then replace the import for session utils:

```ts
// REMOVE:
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE } from "../common/session/session.util";

// ADD:
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE } from '@app/common';
```

Also remove the local `UserRole` type declaration at the top of the controller file — it is now imported from `@app/common` via `AuthService`:

```ts
// REMOVE this line:
type UserRole = "customer" | "driver" | "operator" | "parcel_sender";
```

- [ ] **Step 5: Create `apps/gateway/src/auth/auth.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npm run test:api -- --testPathPattern="apps/gateway/src/auth/auth.service"
```

Expected: PASS — `AuthService` instantiates with mocked `SupabaseService` and `ConfigService`.

- [ ] **Step 7: Commit**

```bash
git add apps/gateway/src/auth/
git commit -m "feat(gateway): add auth module with ConfigService injection and @app/* imports"
```

---

## Task 8: Write `apps/gateway/src/gateway/gateway.module.ts`

Proxy targets read from `ConfigService` instead of hardcoded.

**Files:**
- Create: `apps/gateway/src/gateway/gateway.module.ts`

- [ ] **Step 1: Create `apps/gateway/src/gateway/gateway.module.ts`**

```ts
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createProxyMiddleware } from 'http-proxy-middleware';

@Module({})
export class GatewayModule implements NestModule {
  constructor(private readonly configService: ConfigService) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(
        createProxyMiddleware({
          target: this.configService.get<string>('PAKISHIP_URL', 'http://localhost:3001'),
          changeOrigin: true,
          pathRewrite: { '^/api/ship': '' },
        }),
      )
      .forRoutes('/api/ship');

    consumer
      .apply(
        createProxyMiddleware({
          target: this.configService.get<string>('PAKIPARK_URL', 'http://localhost:3002'),
          changeOrigin: true,
          pathRewrite: { '^/api/park': '' },
        }),
      )
      .forRoutes('/api/park');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/gateway/src/gateway/gateway.module.ts
git commit -m "feat(gateway): configure proxy targets via ConfigService env vars"
```

---

## Task 9: Write `apps/gateway/src/payment/` module files

`PaymentService` uses `ConfigService`. `PaymentController` gets the `IdempotencyInterceptor` applied at the route level. `PaymentModule` wires both together.

**Files:**
- Create: `apps/gateway/src/payment/payment.service.ts`
- Create: `apps/gateway/src/payment/payment.controller.ts`
- Create: `apps/gateway/src/payment/payment.module.ts`

- [ ] **Step 1: Create `apps/gateway/src/payment/payment.service.ts`**

```ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TribeClient } from '@implementsprint/sdk';

@Injectable()
export class PaymentService {
  private readonly client: TribeClient;

  constructor(private readonly configService: ConfigService) {
    this.client = new TribeClient({
      gatewayUrl: configService.get<string>('APICENTER_URL', 'https://api-center-test.itsandbox.site'),
      tribeId: configService.get<string>('APICENTER_TRIBE_ID', 'pakiapps'),
      secret: configService.get<string>('APICENTER_TRIBE_SECRET', ''),
    });
  }

  async processCheckout(body: { draftId: string; price: number }) {
    return this.createEwalletCheckout(body.draftId, body.price);
  }

  async createEwalletCheckout(draftId: string, price: number) {
    try {
      await this.client.authenticate();

      return await this.client.paymentCreateCheckoutSession({
        referenceId: `draft-${draftId}`,
        idempotencyKey: `checkout-${draftId}-${Date.now()}`,
        successUrl: `pakiship://payment-success?draftId=${draftId}`,
        cancelUrl: `pakiship://payment-cancel?draftId=${draftId}`,
        paymentMethods: ['gcash', 'maya', 'qrph'],
        lineItems: [
          {
            name: 'PakiShip Parcel Delivery',
            quantity: 1,
            amount: { value: Math.round(price * 100), currency: 'PHP' },
          },
        ],
      });
    } catch (error) {
      throw new InternalServerErrorException('Failed to generate payment link.');
    }
  }
}
```

- [ ] **Step 2: Create `apps/gateway/src/payment/payment.controller.ts`**

```ts
import { Controller, Post, Body, UseInterceptors } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';

@Controller('api/payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('checkout')
  @UseInterceptors(IdempotencyInterceptor)
  async checkout(@Body() body: { draftId: string; price: number }) {
    return this.paymentService.processCheckout(body);
  }
}
```

- [ ] **Step 3: Create `apps/gateway/src/payment/payment.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';

@Module({
  controllers: [PaymentController],
  providers: [PaymentService, IdempotencyInterceptor],
})
export class PaymentModule {}
```

- [ ] **Step 4: Commit**

```bash
git add apps/gateway/src/payment/
git commit -m "feat(gateway): add payment module with ConfigService and route-level idempotency"
```

---

## Task 10: Write `apps/gateway/src/common/interceptors/idempotency.interceptor.ts`

Replace hardcoded `localhost:6379` with `ConfigService` injection.

**Files:**
- Create: `apps/gateway/src/common/interceptors/idempotency.interceptor.ts`

- [ ] **Step 1: Create `apps/gateway/src/common/interceptors/idempotency.interceptor.ts`**

```ts
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import Redis from 'ioredis';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly redisClient: Redis;

  constructor(private readonly configService: ConfigService) {
    this.redisClient = new Redis({
      host: configService.get<string>('REDIS_HOST', 'localhost'),
      port: configService.get<number>('REDIS_PORT', 6379),
    });
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      method: string;
    }>();

    const idempotencyKey = request.headers['x-idempotency-key'];

    if (!idempotencyKey || !['POST', 'PUT', 'PATCH'].includes(request.method)) {
      return next.handle();
    }

    const redisKey = `idempotency:${idempotencyKey}`;

    const isLockAcquired = await this.redisClient.set(
      `lock:${idempotencyKey}`,
      'LOCKED',
      'EX',
      30,
      'NX',
    );

    const cachedResponse = await this.redisClient.get(redisKey);
    if (cachedResponse) {
      await this.redisClient.del(`lock:${idempotencyKey}`);
      return of(JSON.parse(cachedResponse) as unknown);
    }

    if (!isLockAcquired) {
      throw new HttpException(
        'Request is already being processed. Please wait.',
        HttpStatus.CONFLICT,
      );
    }

    return next.handle().pipe(
      tap(async (responseData: unknown) => {
        try {
          await this.redisClient.set(
            redisKey,
            JSON.stringify(responseData),
            'EX',
            86400,
          );
        } finally {
          await this.redisClient.del(`lock:${idempotencyKey}`);
        }
      }),
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/gateway/src/common/interceptors/idempotency.interceptor.ts
git commit -m "feat(gateway): add IdempotencyInterceptor with ConfigService Redis config"
```

---

## Task 11: Write `apps/gateway/src/notifications/` repository, module, and controller

Update `SupabaseService` import to `@app/supabase`. Update session type imports to `@app/common`.

**Files:**
- Create: `apps/gateway/src/notifications/notifications.repository.ts`
- Create: `apps/gateway/src/notifications/notifications.module.ts`
- Create: `apps/gateway/src/notifications/notifications.controller.ts`

- [ ] **Step 1: Create `apps/gateway/src/notifications/notifications.repository.ts`**

Copy the full content from `C:\Users\jmper\Documents\gateway\src\notifications\notifications.repository.ts`, then replace the import:

```ts
// REMOVE:
import { SupabaseService } from "../supabase/supabase.service";

// ADD:
import { SupabaseService } from '@app/supabase';
```

- [ ] **Step 2: Create `apps/gateway/src/notifications/notifications.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsRepository],
})
export class NotificationsModule {}
```

- [ ] **Step 3: Create `apps/gateway/src/notifications/notifications.controller.ts`**

Copy the full content from `C:\Users\jmper\Documents\gateway\src\notifications\notifications.controller.ts`, then replace imports:

```ts
// REMOVE:
import { SessionAuthGuard } from "../common/session/session-auth.guard";
import type { SessionPayload } from "../common/session/session.types";

// ADD:
import { SessionAuthGuard, type SessionPayload } from '@app/common';
```

- [ ] **Step 4: Commit**

```bash
git add apps/gateway/src/notifications/notifications.repository.ts apps/gateway/src/notifications/notifications.module.ts apps/gateway/src/notifications/notifications.controller.ts
git commit -m "feat(gateway): add notifications module with updated @app/* imports"
```

---

## Task 12: Update `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add gateway-specific env vars to `.env.example`**

Append the following section at the end of `.env.example`:

```
# =============================================================================
# Gateway app — additional variables
# =============================================================================

# Proxy targets — LOW sensitivity
# URLs of downstream microservices that the gateway proxies requests to.
PAKISHIP_URL=http://localhost:3001
PAKIPARK_URL=http://localhost:3002

# Redis — LOW sensitivity
# Used by the gateway's rate limiter (ThrottlerModule) and idempotency interceptor.
REDIS_HOST=localhost
REDIS_PORT=6379

# Auth secret — HIGH sensitivity
# Used to hash password-reset OTP references. Store in Vault / GitHub Secrets.
AUTH_SECRET=change-me-in-production
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add gateway env vars to .env.example (PAKISHIP_URL, PAKIPARK_URL, REDIS, AUTH_SECRET)"
```

---

## Task 13: Add gateway Jest project and verify test suite

**Files:**
- Modify: `package.json` (jest.projects array)

- [ ] **Step 1: Add gateway project to `jest.projects` in `package.json`**

Inside the `"jest"` → `"projects"` array, add after the `location-service` project entry:

```json
{
  "displayName": "gateway",
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testRegex": "(apps/gateway|libs)/(.*)\\.spec\\.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "moduleNameMapper": {
    "^@app/common$": "<rootDir>/libs/common/src",
    "^@app/common/(.*)$": "<rootDir>/libs/common/src/$1",
    "^@app/api-center$": "<rootDir>/libs/api-center/src",
    "^@app/api-center/(.*)$": "<rootDir>/libs/api-center/src/$1",
    "^@app/supabase$": "<rootDir>/libs/supabase/src",
    "^@app/supabase/(.*)$": "<rootDir>/libs/supabase/src/$1",
    "^@app/contracts$": "<rootDir>/libs/contracts/src",
    "^@app/contracts/(.*)$": "<rootDir>/libs/contracts/src/$1",
    "^(\\.{1,2}/.*)\\.js$": "$1"
  },
  "collectCoverageFrom": [
    "apps/gateway/src/**/*.ts",
    "libs/**/*.ts"
  ],
  "coveragePathIgnorePatterns": [
    "/node_modules/",
    "apps/gateway/src/main.ts",
    "\\.module\\.ts$",
    "index\\.ts$"
  ],
  "testEnvironment": "node"
}
```

- [ ] **Step 2: Run gateway tests**

```bash
npm run test:gateway
```

Expected: all spec files pass. If any fail, fix the import or mock before continuing.

- [ ] **Step 3: Run full test suite to confirm no regressions**

```bash
npm test
```

Expected: all existing `api` and `location-service` tests still pass.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "test(gateway): add gateway jest project entry"
```

---

## Task 14: Typecheck and build

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: 0 errors. If TypeScript reports errors, resolve them before proceeding — common causes are incorrect import paths, missing type annotations on `any` usages in strict mode, or `process.env` access that bypasses `noUncheckedIndexedAccess`.

- [ ] **Step 2: Build gateway**

```bash
npm run build:gateway
```

Expected: compiles to `dist/apps/gateway/main.js` without errors.

- [ ] **Step 3: Confirm existing builds still work**

```bash
npm run build:api
```

Expected: compiles without errors.

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "chore: verify gateway integration builds and typechecks cleanly"
```

---

## Completion Checklist

- [ ] `nest-cli.json` has `gateway` project entry
- [ ] `apps/gateway/tsconfig.app.json` mirrors `apps/api/tsconfig.app.json`
- [ ] `package.json` has gateway scripts and new dependencies installed
- [ ] `apps/gateway/Dockerfile` exists
- [ ] `libs/supabase`: `logActivity`, `createAdminClient`, `createServerClient` methods added and tested
- [ ] `libs/common`: `SessionPayload`, `UserRole`, `session.util`, `SessionAuthGuard`, `LoggingModule` exported from `index.ts`
- [ ] `apps/gateway/src/main.ts` uses `NestExpressApplication`, helmet, CORS, `ValidationPipe`, `AllExceptionsFilter`, `ConfigService`
- [ ] `apps/gateway/src/app.module.ts` imports `SupabaseModule` from `@app/supabase`, `LoggingModule` from `@app/common`, no global `IdempotencyInterceptor`
- [ ] `AuthService` injects `ConfigService`, imports from `@app/supabase` and `@app/common`
- [ ] `GatewayModule` reads `PAKISHIP_URL` / `PAKIPARK_URL` from `ConfigService`
- [ ] `PaymentService` injects `ConfigService`
- [ ] `PaymentController` applies `@UseInterceptors(IdempotencyInterceptor)` on `POST /checkout`
- [ ] `PaymentModule` registers `PaymentController` and `IdempotencyInterceptor` as providers
- [ ] `IdempotencyInterceptor` injects `ConfigService` for Redis host/port
- [ ] `NotificationsRepository` imports `SupabaseService` from `@app/supabase`
- [ ] `.env.example` documents `PAKISHIP_URL`, `PAKIPARK_URL`, `REDIS_HOST`, `REDIS_PORT`, `AUTH_SECRET`
- [ ] `npm test` passes with no regressions
- [ ] `npm run typecheck` reports 0 errors
- [ ] `npm run build:gateway` succeeds
