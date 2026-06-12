# Nest Backend

This folder contains the NestJS backend for the app while the frontend remains in Next.js.

## Run

1. Install backend dependencies:

```bash
npm install --prefix backend
```

2. Create a backend env file from [`.env.example`](/Users/jods/Downloads/pakiship-backend-minor-repo-main/backend/.env.example).

3. Start the Nest API:

```bash
npm run backend:dev
```

The API runs on `http://localhost:4000` by default and exposes routes under `/api`.

## Frontend

Point the Next frontend to Nest by adding this to [`frontend/.env.local`](/Users/jods/Downloads/pakiship-backend-minor-repo-main/frontend/.env.local):

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

The frontend uses [`src/lib/api-client.ts`](/Users/jods/Downloads/pakiship-backend-minor-repo-main/src/lib/api-client.ts) and sends cookies with `credentials: "include"` so auth-protected parcel routes still work.
