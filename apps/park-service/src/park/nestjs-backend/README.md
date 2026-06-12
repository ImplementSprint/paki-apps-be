# PakiPark NestJS Backend

Production-ready NestJS backend — full migration from Express/Sequelize.

## Quick Start

```bash
cd src/Backend/nestjs-backend
cp .env.example .env          # fill in your values
npm install
npm run build
npm run start:prod            # production
npm run start:dev             # dev with hot-reload
```

## Architecture

```
src/
├── main.ts                  # Bootstrap — port 5000, global prefix /api
├── app.module.ts            # Root module
├── common/                  # Global services & guard
│   ├── jwt-auth.guard.ts    # Supabase JWT verification + role guard
│   ├── supabase.service.ts  # Supabase Admin client
│   ├── api-center.service.ts# PakiShip integration (retry + token refresh)
│   ├── time.utils.ts        # Slot parsing, grace period, overtime calc
│   └── formatters.ts        # Response formatters
├── models/                  # Sequelize models (schema-aware)
│   ├── booking.model.ts     # reservation.bookings
│   ├── location.model.ts    # parking_lot.locations
│   ├── parking-slot.model.ts# parking_lot.parking_slots
│   ├── parking-rate.model.ts# public.parking_rates
│   ├── user.model.ts        # public.users
│   ├── vehicle.model.ts     # teller.vehicles
│   ├── notification.model.ts# notifications.notifications
│   ├── review.model.ts      # partner.reviews
│   ├── activity-log.model.ts# partner.activity_logs
│   ├── transaction-log.model.ts # reservation.transaction_logs
│   ├── settings.model.ts    # teller.settings
│   ├── upload.model.ts      # teller.uploads
│   └── payment-method.model.ts  # public.payment_methods
├── auth/                    # POST /api/auth/*
├── booking/                 # POST/GET /api/bookings/*
├── location/                # GET/POST /api/locations/*
├── user/                    # GET/PUT /api/users/*
├── vehicle/                 # GET/POST /api/vehicles/*
├── parking-slot/            # GET/POST /api/parking-slots/*
├── analytics/               # GET /api/analytics/*
├── settings/                # GET/PUT /api/settings/*
├── upload/                  # POST /api/uploads/*
├── review/                  # GET/POST /api/reviews/*
├── payment/                 # POST /api/payment/*
├── payment-method/          # GET/POST /api/payment-methods/*
├── sms/                     # SmsService (Semaphore)
├── email/                   # EmailService (SMTP)
├── notification/            # Fire-and-forget push + DB notifications
├── logs/                    # LogService (activity + transaction logs)
└── scheduler/               # Forfeiture sweeper (every 60s)
    └── scheduler.service.ts # No-show auto-forfeit + 30-min reminders
```

## Route Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/register | 🔓 | Customer registration |
| POST | /api/auth/register-admin | 🔓 | Teller/Admin/BP registration |
| POST | /api/auth/login | 🔓 | Login (email or phone) |
| POST | /api/auth/logout | 🔒 | Logout |
| POST | /api/auth/refresh | 🔒 | Token refresh |
| GET | /api/bookings | 🔒 | List bookings (scoped by role) |
| POST | /api/bookings | 🔒 | Create booking |
| POST | /api/bookings/:id/check-in | 🔒 | Check-in (validates grace period) |
| POST | /api/bookings/:id/check-out | 🔒 | Check-out (calculates overtime) |
| POST | /api/bookings/:id/cancel | 🔒 | Cancel booking |
| GET | /api/locations | 🔒 | List locations |
| GET | /api/parking-slots/dashboard | 🔒 | Live slot dashboard with timing |
| GET | /api/analytics/dashboard | 🔒 Admin | Dashboard stats |
| POST | /api/uploads/avatar | 🔒 | Upload profile photo → Supabase Storage |
| GET | /api/health | 🔓 | Health check |

## Key Business Logic

### Booking Lifecycle
1. **Create** → atomic: decrement `availableSpots`, snapshot user/vehicle data
2. **Check-in** → validates within grace period (15 min after slot start)
3. **Check-out** → calculates overtime `⌈extra_minutes / 60⌉ × ₱15`
4. **Forfeiture** → background sweep every 60s auto-cancels no-shows

### RBAC Roles
| Role | Permissions |
|------|-------------|
| `customer` | Own bookings, profile, vehicles |
| `teller` | Check-in/out, slot dashboard, own hub bookings |
| `business_partner` | Own location bookings, stats |
| `admin` | Full access |

### Database Schemas
The backend spans multiple Postgres schemas:

| Schema | Tables |
|--------|--------|
| `account` | `profiles` |
| `public` | `users`, `payment_methods`, `parking_rates`, `parking_slots` |
| `parking_lot` | `locations`, `parking_slots`, `parking_rates` |
| `reservation` | `bookings`, `transaction_logs` |
| `notifications` | `notifications` |
| `partner` | `reviews`, `activity_logs` |
| `teller` | `vehicles`, `settings`, `uploads` |

## Environment Variables

See `.env.example` for the full list. Required:
- `DATABASE_URL` — Supabase Postgres connection string
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — Admin API access
- `PAYMONGO_SECRET_KEY` — Payment processing
- `SEMAPHORE_API_KEY` — SMS notifications
