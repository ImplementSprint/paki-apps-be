# Gateway Integration Design

**Date:** 2026-05-23
**Branch:** `monorepo-integration`
**Approach:** Approach A — Direct lift-and-shift

## Overview

Integrate the standalone `gateway` repository into the `pakiapps-be` NestJS monorepo as `apps/gateway`. The gateway provides auth (signup, signin, 2FA, password reset), notifications, payment, and reverse-proxy routing to downstream microservices (pakiSHIP, pakiPARK). All shared concerns are extracted to `libs/` and the app is conformed to monorepo conventions.

---

## 1. Repository & Monorepo Structure

### `nest-cli.json`
Add a new project entry:
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

### `apps/gateway/tsconfig.app.json`
Mirror the pattern from `apps/api/tsconfig.app.json`.

### `package.json` scripts
Add:
```
build:gateway
start:gateway
start:gateway:dev
start:prod:gateway
test:gateway
```

### New dependencies (merged into monorepo root)
- `@nest-lab/throttler-storage-redis`
- `@nestjs/throttler`
- `@nestjs/axios`
- `http-proxy-middleware`
- `ioredis`
- `@types/ioredis` (devDependencies)

### `apps/gateway/Dockerfile`
New file mirroring `apps/api/Dockerfile`.

---

## 2. Shared Library Changes

### `libs/common` — four additions

**Session types** (`session.types.ts`)
- Moved from `gateway/src/common/session/session.types.ts`
- Exports `SessionPayload` and `UserRole`
- Added to `libs/common/src/index.ts`

**Session utilities**
- `session.util.ts` and `session-auth.guard.ts` moved from `gateway/src/common/session/`
- Exported from `libs/common/src/index.ts`
- Depend only on `SessionPayload`/`UserRole` and NestJS core — no gateway-specific coupling

**`IdempotencyInterceptor`**
- Stays in `apps/gateway/src/common/interceptors/` — not moved to `libs/common`
- Reason: its implementation depends on `ioredis` directly; moving it to `libs/common` would add an `ioredis` coupling to a library that `apps/api` uses and should never need Redis
- Hardcoded `localhost:6379` in its constructor is replaced with `ConfigService` injection reading `REDIS_HOST` / `REDIS_PORT`
- No longer registered as a global `APP_INTERCEPTOR`
- Applied opt-in via `@UseInterceptors(IdempotencyInterceptor)` at the controller method level on critical mutations (POST, PUT, PATCH)

**`LoggingModule`**
- Moved from `gateway/src/logging/logging.module.ts`
- Exported from `libs/common/src/index.ts`
- Both `apps/api` and `apps/gateway` import it

### `libs/supabase` — one addition

**`logActivity`**
- Merged from gateway's `SupabaseService`
- Signature: `logActivity(userId, actionType, entityType, entityId, descriptionFn: (name: string) => string): Promise<void>`
- Operates on `account.profiles` and `public.audit_logs` via the existing admin client
- No new dependencies

### `libs/contracts` — no changes
Session types go to `libs/common` (runtime auth concern, not inter-service message contract).

---

## 3. `apps/gateway` App Internals

### `main.ts`
Rewritten to match `apps/api/main.ts` conventions:
- `NestExpressApplication`
- Helmet via `helmetConfig` / `helmetConfigSwagger` from `@app/common`
- CORS via `corsOptions()` from `@app/common`
- `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`
- `AllExceptionsFilter` from `@app/common`
- Global prefix `api/v1`
- `PORT` read via `ConfigService`
- `Logger` from `@nestjs/common`

### `app.module.ts`
- `ConfigModule.forRoot` kept (global, loads `.env`)
- `ThrottlerModule.forRootAsync` kept with Redis storage; `REDIS_HOST` and `REDIS_PORT` read via `ConfigService`
- `LoggingModule` imported from `@app/common`
- `APP_INTERCEPTOR` provider for `IdempotencyInterceptor` **removed**
- All domain modules retained: `AuthModule`, `NotificationsModule`, `PaymentModule`, `GatewayModule`
- Gateway's own `SupabaseModule` removed; `SupabaseModule` from `@app/supabase` imported instead

### `supabase/`
- Gateway's own `supabase/` directory deleted
- `apps/gateway` imports `SupabaseModule` from `@app/supabase`

### `auth/auth.service.ts`
- `SupabaseService` injected from `@app/supabase`
- `TribeClient` instantiation migrated from `process.env` to `ConfigService` for `APICENTER_URL`, `APICENTER_TRIBE_ID`, `APICENTER_TRIBE_SECRET`
- Session types imported from `@app/common`

### `payment/payment.service.ts`
- `TribeClient` instantiation updated to use `ConfigService`
- `@UseInterceptors(IdempotencyInterceptor)` applied to the `POST /checkout` controller method, imported from `@app/common`

### `gateway/gateway.module.ts`
- Proxy targets replaced with ConfigService-driven values:
  ```ts
  target: configService.get<string>('PAKISHIP_URL', 'http://localhost:3001')
  target: configService.get<string>('PAKIPARK_URL', 'http://localhost:3002')
  ```
- `GatewayModule` injects `ConfigService`

### `notifications/`, `auth/auth.controller.ts`, `auth/two-factor.util.ts`
- No structural changes
- Import paths updated to use `@app/common` for session types

### `.env.example` additions
```
# Gateway proxy targets
PAKISHIP_URL=http://localhost:3001   # LOW sensitivity
PAKIPARK_URL=http://localhost:3002   # LOW sensitivity

# Redis (gateway rate limiter)
REDIS_HOST=localhost                 # LOW sensitivity
REDIS_PORT=6379                      # LOW sensitivity

# Auth secret (gateway OTP hashing)
AUTH_SECRET=change-me-in-production  # HIGH sensitivity
```

---

## 4. Testing Conventions

### Jest project entry (root `package.json`)
```json
{
  "displayName": "gateway",
  "rootDir": ".",
  "testRegex": "(apps/gateway|libs)/(.*)\\.spec\\.ts$",
  "moduleFileExtensions": ["js", "json", "ts"],
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "moduleNameMapper": {
    "^@app/common(.*)$": "<rootDir>/libs/common/src$1",
    "^@app/supabase(.*)$": "<rootDir>/libs/supabase/src$1",
    "^@app/api-center(.*)$": "<rootDir>/libs/api-center/src$1",
    "^@app/contracts(.*)$": "<rootDir>/libs/contracts/src$1"
  },
  "collectCoverageFrom": ["apps/gateway/src/**/*.ts", "libs/**/*.ts"],
  "coveragePathIgnorePatterns": [
    "/node_modules/",
    "apps/gateway/src/main.ts",
    "\\.module\\.ts$",
    "index\\.ts$"
  ],
  "testEnvironment": "node"
}
```

### Existing gateway specs
- Moved to `apps/gateway/src/` alongside their modules
- Import paths updated to `@app/` aliases for session types and `SupabaseService`
- Flat `rootDir: "src"` config from the standalone repo discarded

### E2E tests
- Out of scope for this integration; added in a follow-up

---

## 5. Out of Scope

- E2E tests for the gateway
- CI/CD pipeline changes (Render deploy hooks for the gateway)
- Database migrations
- Any new feature work on the gateway

---

## Decision Log

| Decision | Choice | Reason |
|---|---|---|
| `logActivity` placement | `libs/supabase` | Cross-cutting audit concern; operates entirely via Supabase admin client |
| Session types placement | `libs/common` | Runtime auth concern shared across apps |
| Proxy target configuration | ConfigService env vars | Conforms to pakiapps-be pattern; enables environment-specific deployment |
| `IdempotencyInterceptor` scope | Opt-in, route-level; stays in `apps/gateway` | Industry standard; global was too broad. Kept in gateway because `ioredis` dep must not leak into `libs/common` |
| `LoggingModule` placement | `libs/common` | Cross-cutting concern; both apps benefit |
| Integration approach | Approach A (direct lift-and-shift) | Single PR, clean result, avoids parallel repo maintenance |
