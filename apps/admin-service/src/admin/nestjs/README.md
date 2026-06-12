# PakiShip Admin NestJS Backend

This backend is scoped to PakiShip Admin shipments and profile only.

It uses NestJS and Supabase PostgREST. The frontend-facing API routes stay under `/api/pakiship/...`.

## Supabase setup

Create `backend/.env`:

```text
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-secret-or-service-role-key
PAKISHIP_BACKEND_PORT=4000
PAKISHIP_ADMIN_EMAIL=admin@gmail.com
```

This backend uses existing Supabase tables. Do not create separate PakiShip shipment/profile tables for this backend.

Profile uses:

- `account.profiles`
- `account.admin_accounts`

Set `PAKISHIP_ADMIN_EMAIL` to the admin profile email that should load in PakiShip Admin. You can also set `PAKISHIP_ADMIN_PROFILE_ID` to force a specific `account.profiles.id`.

Shipments use:

- `parcel.driver_jobs`
- `parcel.driver_job_events`
- `account.profiles` for driver names

## Run

```bash
npm run backend:dev
```

Default API base URL:

```text
http://localhost:4000/api
```

Use `PAKISHIP_BACKEND_PORT=4100` or `PORT=4100` to change the port.

## Shipments

### List shipments

```http
GET /api/pakiship/shipments
```

Query parameters:

- `search`
- `status`: `All`, `In Transit`, `Pending`, `Delivered`, `Cancelled`
- `driver`
- `startDate`: `YYYY-MM-DD`
- `endDate`: `YYYY-MM-DD`
- `page`
- `limit`

### Get one shipment

```http
GET /api/pakiship/shipments/:id
```

### Get driver filter options

```http
GET /api/pakiship/shipments/drivers
```

### Update shipment status

```http
PATCH /api/pakiship/shipments/:id/status
Content-Type: application/json

{
  "status": "Delivered",
  "reason": "Delivery confirmed by assigned driver.",
  "updatedBy": "PakiShip Admin"
}
```

Every status update appends a `statusHistory` audit item.

## Profile

### Get current PakiShip admin profile

```http
GET /api/pakiship/profile
```

### Update profile details

```http
PATCH /api/pakiship/profile
Content-Type: application/json

{
  "name": "Zachary Miguel Navarro",
  "email": "admin@gmail.com",
  "phone": "09123456789",
  "address": "Espana Blvd., Sampaloc, Manila",
  "dob": "2005-06-01"
}
```

### Update profile photo

```http
PATCH /api/pakiship/profile/photo
Content-Type: application/json

{
  "profilePicture": "data:image/png;base64,..."
}
```

### Remove profile photo

```http
DELETE /api/pakiship/profile/photo
```

### Change password

```http
PATCH /api/pakiship/profile/password
Content-Type: application/json

{
  "currentPassword": "Admin@123",
  "newPassword": "Backend@12345"
}
```

The current implementation uses validated DTOs and Supabase tables for persistence.
