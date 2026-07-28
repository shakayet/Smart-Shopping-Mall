# Closeté Admin & Operations Dashboard — Web Implementation Guideline

v1.0 — audited against backend source of truth, ⚠️ marks backend caveats that need workaround or future backend fix.

> Authoritative backend source references (read before filing bugs):
> - [routes/index.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/routes/index.ts#L1-L49)
> - [order.route.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/order/order.route.ts)
> - [order.service.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/order/order.service.ts)
> - [issue.route.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/issue/issue.route.ts)
> - [issue.service.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/issue/issue.service.ts)
> - [user.route.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/user/user.route.ts)
> - [product.route.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/product/product.route.ts)
> - [QueryBuilder.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/app/builder/QueryBuilder.ts#L1-L94)
> - [auth.ts middleware](file:///c:/Development/Smart%20Shopping%20Mall/src/app/middlewares/auth.ts#L8-L39)

---

## 1. Project Overview

Closeté Admin Dashboard is a **React/Next.js-style SPA** used by back-office administrators and operations teams to run the Closeté luxury-resale marketplace. Unlike the buyer/seller mobile app, admin users have **no self-onboarding** — every admin account is created by Super Admin via the seed script or an existing admin (currently: DB-level only, see §10 for recommended fix).

### Supported roles

From [seedAdmin.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/DB/seedAdmin.ts) + enums/user.ts:

| role | permissions |
|------|-------------|
| `super_admin` | Full access to Users CRUD, Orders, Issues, Products, Payout marking, future super ops (not differentiated from ADMIN in any route today; see §10). |
| `admin` | All operational actions: full Orders CR transitions, Issues CRUD/resolve, Products moderation, Users table view, payout marking. |
| `user` | Buyers/sellers only — explicitly blocked from every `/admin/*` route via `auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN)` middleware. |

⚠️ **Backend caveat (P2 #4):** Both ADMIN and SUPER_ADMIN share identical permission gates today; the only real difference is the seed entry. Defer role-differentiated UI gating to a future backend milestone that hardens the actual service layer checks instead of only route gating.

### Typical operations users
- **Verification operators** → scan QR/receive physical goods, move `SECURED → COLLECTION_PENDING → COLLECTED → VERIFICATION` (the "warehouse pipeline"), create Issues when items fail authentication.
- **Finance operators** → `VERIFICATION → PAYOUT_PROCESSING → markPayoutPaid → READY_FOR_DELIVERY → DELIVERED → COMPLETED`, track refunds.
- **Support / Trust & Safety** → open Issues, resolve with `delete` or `make_available`.
- **Super Admin / Marketplace owner** → Users list, stats, audit, product moderation.

---

## 2. Recommended Web Stack

This is the team's official default. Exceptions require architecture review.

| Concern | Choice | Why |
|---------|--------|-----|
| Framework | **Next.js 14+ (App Router)** | React Server Components optional for the dashboard pages; keep data-fetching RSC and heavy interaction pages as client components with `"use client"`. |
| Language | TypeScript 5.4+ strict (`"strict": true`) | Matches backend. `tsconfig` paths: `@/*` → `src/*`. |
| UI Kit | **Ant Design v5** (Pro components add-on recommended) | Data-dense tables, Form, Descriptions, Steps, Drawer, Modal all pre-built for ops-dashboard UX. |
| Styling | Tailwind CSS v3 (with Tailwind Antd preset) + CSS Modules for bespoke components | |
| Auth token storage | **`js-cookie`** (httpOnly if Next.js rewrites proxy cookies) + `localStorage` accessor wrapper. Prefer short-lived httpOnly cookies for admin JWT if you can. | Admin accounts should be treated as high-value targets. |
| HTTP client | **`axios` v1** + 2 interceptors (request → attach Bearer; response → 401 → refresh with single-flight lock). | See §3. |
| Query/Server-state | **TanStack Query v5 (React Query)** + `queryClient.setQueryData` for optimistic transitions. | Critical for data-dense admin tables. |
| Form lib | `react-hook-form` v7 + `zod` resolver (share zod schemas exported by backend if possible). | |
| State (client) | **Zustand** — only for UI state: selected rows, drawer open/closed, filters. Keep it small. | |
| Navigation / routing | Next.js App Router file routes with route groups `(dashboard)/…` and middleware for role checks. | |
| Charts | **Recharts** (line, area, bar, pie, funnels). | |
| Live updates | **Socket.IO client v4** with fallback: 30s interval polling until backend wires event emits. ⚠️ See §5 | |
| i18n | `next-intl` if Arabic required; otherwise English v1. Closeté brand targets UAE. | |
| Testing | **Vitest** + Testing Library unit; **Playwright** for e2e order flows. | |
| Lint / Format | ESLint flat config (`@typescript-eslint` + `eslint-plugin-react-hooks`), Prettier, Husky pre-commit lint-staged. | |

---

## 3. HTTP Client — Axios with Refresh Single-flight

### Base config
```ts
// src/lib/http.ts
import axios, { AxiosError, HttpStatusCode } from 'axios';
import Cookies from 'js-cookie';

export const http = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:5000/api/v1',
  timeout: 30_000,
  headers: { Accept: 'application/json' },
});

// ---- Token storage helpers ----
export const tokenStore = {
  get access(): string | undefined { return Cookies.get('at') ?? localStorage.getItem('at') ?? undefined; },
  set access(v: string | undefined) {
    if (!v) { Cookies.remove('at'); localStorage.removeItem('at'); return; }
    Cookies.set('at', v, { secure: location.protocol === 'https:', sameSite: 'lax' });
    localStorage.setItem('at', v);
  },
  get refresh(): string | undefined { return Cookies.get('rt') ?? localStorage.getItem('rt') ?? undefined; },
  set refresh(v: string | undefined) {
    if (!v) { Cookies.remove('rt'); localStorage.removeItem('rt'); return; }
    Cookies.set('rt', v, { secure: location.protocol === 'https:', sameSite: 'lax' });
    localStorage.setItem('rt', v);
  },
  clear() { this.access = undefined; this.refresh = undefined; },
};

// ---- Auth interceptor ----
http.interceptors.request.use((config) => {
  // ⚠️ NON-STANDARD BACKEND BEHAVIOR: /auth/reset-password expects raw token
  // without "Bearer " prefix. Admin dash does not normally call reset-password
  // but keep the parity so we don't regress if we ever expose it:
  const isResetPassword = (config.url ?? '').includes('/auth/reset-password');
  const token = isResetPassword ? tokenStore.refresh : tokenStore.access;
  if (token && config.headers && !config.headers.Authorization) {
    config.headers.Authorization = isResetPassword ? token : `Bearer ${token}`;
  }
  return config;
});

// ---- Refresh single-flight (prevents thundering herd of 401s) ----
let refreshPromise: Promise<string | null> | null = null;
let isRefreshing = false;

async function attemptRefresh(): Promise<string | null> {
  if (isRefreshing) return refreshPromise ?? null;
  isRefreshing = true;
  refreshPromise = (async () => {
    const rt = tokenStore.refresh;
    if (!rt) return null;
    try {
      const res = await axios.post(
        `${http.defaults.baseURL}/auth/refresh-token`,
        {},
        { headers: { Authorization: `Bearer ${rt}` } },
      );
      const access = res.data?.data?.accessToken;
      const refresh = res.data?.data?.refreshToken;
      if (access) tokenStore.access = access;
      if (refresh) tokenStore.refresh = refresh;
      return access ?? null;
    } catch {
      tokenStore.clear();
      return null;
    } finally {
      isRefreshing = false;
    }
  })();
  return refreshPromise;
}

const SKIP_REFRESH = new Set([
  '/auth/login', '/auth/register', '/auth/verify-email', '/auth/forgot-password',
  '/auth/reset-password',
]);

http.interceptors.response.use(
  (r) => r,
  async (err: AxiosError<{ success?: boolean; message?: string }>) => {
    const url = err.config?.url ?? '';
    if (err.response?.status === HttpStatusCode.Unauthorized && !SKIP_REFRESH.has(url)) {
      const newAccess = await attemptRefresh();
      if (newAccess && err.config) {
        const isReset = url.includes('/auth/reset-password');
        err.config.headers.Authorization = isReset ? newAccess : `Bearer ${newAccess}`;
        return http.request(err.config);
      }
      tokenStore.clear();
      // redirect to login without looping
      if (typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
        location.href = '/login?redirect=' + encodeURIComponent(location.pathname + location.search);
      }
    }
    return Promise.reject(err);
  },
);
```

### Response wrapper — match backend `sendResponse`
Backend [sendResponse.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/shared/sendResponse.ts#L1-L26) and [globalErrorHandler.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/app/middlewares/globalErrorHandler.ts#L1-L73):

```ts
// Type every success response from the API
export interface ApiSuccess<T = unknown> {
  success: true;
  statusCode: number;
  message?: string;
  pagination?: { page: number; limit: number; total: number; totalPage: number };
  data?: T;
}

export type FieldIssue = { path: string; message: string };

export interface ApiErrorShape {
  success: false;
  message: string;
  errorMessages?: FieldIssue[];
  stack?: string; // dev-only
}
```

**TanStack Query helper** — use it everywhere instead of raw axios. It maps Zod/validation errorMessages to Antd Form field errors.

---

## 4. Backend Response & Query Conventions

### Standard envelope
| path in JSON | description |
|---|---|
| `.success` | boolean. Always present. |
| `.message` | human string. Optionally present on success, always present on error. |
| `.pagination` | paginated list shape: `{page, limit, total, totalPage}` (this exact field order from QueryBuilder.ts — use it directly in Ant Design `Table`). |
| `.data` | The actual payload. Often `null` for 204/DELETE. Usually `{result, meta}` for admin tables. |

**For list endpoints, always destructure:**
```ts
const { data: { data: { result, meta } } } = await http.get('/orders/admin/all', { params });
// result = rows[], meta = pagination
```

### QueryBuilder search/filter/pagination parameters
From [QueryBuilder.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/app/builder/QueryBuilder.ts#L12-L94):

| param | behavior |
|---|---|
| `page` | number, default `1` |
| `limit` | number, default `10` (admin: recommend default `20`) |
| **`searchTerm`** ⚠️ | **Search! NOT `search`.** Do not send `search` key — silently ignored. |
| `sort` | e.g. `sort=-createdAt` (minus = desc). Default sort is `-createdAt`. |
| `fields` | e.g. `fields=name,email,_id` — projection. Rarely needed. |
| Any other key (`status`, `role`, `issueType`, etc.) | Treated as **exact equality filter** on the Mongoose model. |

### QueryParams React Hook (reusable)
```ts
// src/hooks/useQueryParams.ts
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function useQueryParams<T extends Record<string, unknown>>() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const set = (patch: Partial<T> | ((prev: T) => T)) => {
    const cur = Object.fromEntries(sp.entries()) as T;
    const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch } as T;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === null || v === '') continue;
      params.set(k, String(v));
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  return { params: Object.fromEntries(sp.entries()) as T, set };
}
```

---

## 5. Live Updates — Socket.IO + Polling Fallback

Backend socket scaffold exists at [socketHelper.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/helpers/socketHelper.ts) but **only wires `connection` and `disconnect` events today — zero business events are emitted**.

⚠️ **Backend caveat (P1 #2):** Until the backend emits events, implement a **30s polling fallback** on the Orders + Issues dashboard page. Swap socket events in once backend ships them per the table below (backwards-compatible):

| Semantic Event | Expected payload (future) | Use-case in admin UI |
|---|---|---|
| `order:status_changed` | `{ orderId, newStatus, changedAt, changedBy }` | Order table row highlight refresh + toast. |
| `order:new` | `{ orderId }` | Dashboard "new orders" counter bump. |
| `issue:created` / `issue:resolved` | `{ issueId }` | Issues list badge refresh. |
| `product:moderation_needed` | `{ productId }` | (future) New AI-fraud flag review. |

**Client-side socket service:**
```ts
// src/lib/socket.ts
import { io, Socket } from 'socket.io-client';
import { tokenStore } from './http';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io(process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:5000', {
    transports: ['websocket', 'polling'],
    auth: (cb) => cb({ token: tokenStore.access ?? '' }),
  });
  socket.on('connect_error', () => { /* polling fallback stays active */ });
  return socket;
}

export function useOrderSocketListeners(onOrderChanged: (id: string) => void) {
  // useEffect in components. Wire when BE ships the events.
  // Fallback: use setInterval(refetch, 30_000) for now.
}
```

---

## 6. Authentication Flow for Admin Users

### Login route
```
POST /api/v1/auth/login
body: { email: string, password: string }
→ 200 data: { accessToken, refreshToken, needsPasswordChange?: boolean, user: AdminUser }
```

From [auth.service.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/auth/auth.service.ts#L21-L69):
- **`!user.verified` → 400 "Please verify your email first"** BEFORE JWT is minted.
- If backend seeded a Super Admin without verifying (not the case today — seed script should set `verified:true` explicitly but verify in staging).

⚠️ **Backend caveat (P0 #1 from Flutter doc, same here):** Resend OTP cannot work for newly-created admins if they ever end up in `verified:false` — `/auth/resend-otp` is gated by `auth(USER_ROLES.USER)`, but login of unverified users is blocked. If you ever expose admin self-signup (don't), you'll hit a catch-22. For v1 admin dash login flow, just accept that admin accounts are seeded with verified:true and skip the verify-email step.

### Auth Route Guard (Next.js middleware)
```ts
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtDecode } from 'jwt-decode';
import { USER_ROLES } from '@/enums/user';

const ADMIN_ROLES = new Set([USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN]);

export function middleware(req: NextRequest) {
  const at = req.cookies.get('at')?.value;
  const path = req.nextUrl.pathname;

  if (path.startsWith('/login')) {
    if (at) return NextResponse.redirect(new URL('/dashboard', req.url));
    return NextResponse.next();
  }

  if (path.startsWith('/dashboard')) {
    if (!at) return NextResponse.redirect(new URL('/login', req.url));
    try {
      const payload = jwtDecode<{ role: string }>(at);
      if (!ADMIN_ROLES.has(payload.role as USER_ROLES)) return NextResponse.redirect(new URL('/login', req.url));
    } catch {
      return NextResponse.redirect(new URL('/login', req.url));
    }
  }
  return NextResponse.next();
}
```

### Refresh token flow
```
POST /api/v1/auth/refresh-token
Headers: Authorization: Bearer <refreshToken>
body: {}
→ 200 data: { accessToken, refreshToken }
```
Call it from the interceptor (single-flight) in §3. Never block on the login screen; on the very first 401 inside the app, refresh silently.

### Logout
Backend has **no token revocation** (no token blacklist). Logout = clear cookies/localStorage + redirect to `/login`. Call `POST /auth/logout` if it exists; otherwise no-op.

---

## 7. Admin App / Information Architecture

### Route groups (App Router)
```
app/
├─ layout.tsx                   # root providers (TanStackQuery, Antd ConfigProvider, Intl)
├─ middleware.ts                # §6 auth guard
├─ login/page.tsx               # login screen
├─ (dashboard)/
│  ├─ layout.tsx                # App shell: Sidebar + Header + <Outlet />
│  ├─ dashboard/
│  │  └─ page.tsx               # Stats cards + KPI charts
│  ├─ orders/
│  │  ├─ page.tsx               # orders/admin/all paginated table
│  │  └─ [id]/
│  │     └─ page.tsx            # order detail + Steps stepper + status transition
│  ├─ issues/
│  │  ├─ page.tsx               # Issues list table
│  │  └─ [id]/
│  │     └─ page.tsx            # Issue detail + 2-action resolve modal
│  ├─ products/
│  │  ├─ page.tsx               # Product catalog + moderation (status/status override)
│  │  └─ [id]/
│  │     └─ page.tsx            # Product detail (edit JSON-only PATCH; images via separate workaround)
│  ├─ users/
│  │  ├─ page.tsx               # Users table admin view
│  │  └─ [id]/
│  │     └─ page.tsx            # User profile view-only + issue/order history (aggregate calls)
│  └─ settings/
│     └─ profile/page.tsx       # admin's own profile image + password change
```

### Sidebar menu order & icons (Ant Design Menu)
1. Dashboard (PieChartOutlined)
2. Orders (ShoppingOutlined) — badge with count of `pending_payment + secured + verification`
3. Issues (WarningOutlined) — badge with count of unresolved
4. Products (AppstoreOutlined)
5. Users (TeamOutlined)
6. Settings (SettingsOutlined) → sub: Profile, (future) Roles

---

## 8. Dashboard KPIs / Charts

### Stats (3 separate aggregate calls for now, no `/stats` endpoint)
⚠️ **Backend caveat (P1 #3):** No `/stats` aggregate endpoint. Until backend ships one, run **4 parallel React Queries** with 5-min staleTime + cached. Don't fire on every mount:

| Metric | How to compute on client |
|---|---|
| `GMV last 30d` | fetch orders with limit=0 won't help; instead run `GET /orders/admin/all?limit=2000` (large) + filter by `status !== CANCELLED, REFUNDED` + sum `order.totalAmount` in last 30d. Optimize after /stats ships. |
| `Platform Revenue 30d` | GMV × 0.12 (`PLATFORM_FEE_PERCENTAGE` = 12 from [config/index.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/config/index.ts#L1-L65)) |
| `Active users` | `GET /user?limit=2000` → count lastLogin within 30d |
| `Pending verifications` | `GET /orders/admin/all?status=verification` `meta.total` |
| `Unresolved issues` | `GET /issues` → array `.filter(i => !i.resolved).length` |

### Charts
1. **Daily GMV area chart** — last 90d, sum by date
2. **Orders by status (donut)** — group admin/all result
3. **Top 10 best-selling categories** — product.category grouping
4. **Payout timeline (bar)** — payout_status=PAID vs payout_status=PENDING grouped per week

---

## 9. Orders Module (Highest Complexity — Read This Twice)

### Order list endpoint
```
GET /orders/admin/all
Auth: ADMIN | SUPER_ADMIN
```
Accepts all QueryBuilder params (§4). Example:
```
GET /orders/admin/all?page=1&limit=20&sort=-createdAt&status=verification&searchTerm=CLT-12345
```

### Order detail
```
GET /orders/:id
Auth: USER (buyer/seller own order) | ADMIN | SUPER_ADMIN
```
Admin always sees detail. Populates product, buyer, seller (`name email contact location`).

### Order Status enum (snake_case exactly)
From [enums/order.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/enums/order.ts#L1-L26):
```ts
export enum ORDER_STATUS {
  PENDING_PAYMENT    = 'pending_payment',
  SECURED            = 'secured',
  COLLECTION_PENDING = 'collection_pending',
  COLLECTED          = 'collected',
  VERIFICATION       = 'verification',
  PAYOUT_PROCESSING  = 'payout_processing',
  READY_FOR_DELIVERY = 'ready_for_delivery',
  DELIVERED          = 'delivered',
  COMPLETED          = 'completed',
  REFUNDED           = 'refunded',
  CANCELLED          = 'cancelled',
}
```

### Strict ORDER_STATUS_TRANSITIONS (MANDATORY — frontend must enforce same list)
From [order.constant.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/order/order.constant.ts#L3-L22):

```ts
export const ORDER_STATUS_TRANSITIONS: Record<ORDER_STATUS, ORDER_STATUS[]> = {
  pending_payment:    [SECURED, CANCELLED],
  secured:            [COLLECTION_PENDING, CANCELLED, REFUNDED],
  collection_pending: [COLLECTED, CANCELLED],
  collected:          [VERIFICATION, CANCELLED],
  verification:       [PAYOUT_PROCESSING, REFUNDED, CANCELLED],
  payout_processing:  [READY_FOR_DELIVERY, REFUNDED, CANCELLED],
  ready_for_delivery: [DELIVERED, REFUNDED, CANCELLED],
  delivered:          [COMPLETED, REFUNDED],
  completed:          [],
  refunded:           [],
  cancelled:          [],
};
```

**Frontend rule:** Build a React component `<OrderStatusStepper status={order.status}>` that **disables all non-allowed transitions** as greyed-out buttons. Never send an invalid transition to backend.

### 3 Types of Action on an Order
#### 1. Admin order status transition
```
PATCH /orders/:id/status
Auth: ADMIN | SUPER_ADMIN
body: { status: ORDER_STATUS (snake_case), note?: string }
```
From [order.service.ts#L189-L236](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/order/order.service.ts#L189-L236):
- **Side effects:** If target status is `REFUNDED` or `CANCELLED`:
  - backend **auto-refunds via Stripe** (`createRefund` on the `paymentIntentId`) IF payment is PAID
  - sets `payment.status = REFUNDED`,
  - resets product → `available` + clears `buyer`.
- If target status is `DELIVERED` or `COMPLETED` → sets product status to `sold`.
- `statusHistory` receives a new entry: `{ status, note?, changedAt: now, changedBy: adminId }`.

#### 2. Admin mark payout PAID
```
PATCH /orders/:id/payout
Auth: ADMIN | SUPER_ADMIN
body: {}
```
From [order.service.ts#L238-L262](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/order/order.service.ts#L238-L262):
- Only allowed AFTER `VERIFICATION` stage (specifically: `status` must be one of `PAYOUT_PROCESSING, READY_FOR_DELIVERY, DELIVERED, COMPLETED`).
- Any earlier status → 400 "Payout can only be marked once the item has passed verification".
- Sets `payoutStatus = PAYOUT_STATUS.PAID` — note this is separate from order.status stepper.

#### 3. User (buyer) Cancel Order
```
POST /orders/:id/cancel
Auth: USER (buyer only)
```
⚠️ Backend allows buyer cancellation **only from `SECURED` status** (not pending_payment). Source [order.service.ts#L277-L282](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/order/order.service.ts#L277-L282). Refunds automatically if payment=PAID.

### Orders Table (Ant Design Pro Table)
**Columns:**
| column | source |
|---|---|
| Order No | `order.orderNumber` (generated `CLT-<8digitTS><rand>`). Render as clickable link → `/orders/[id]`. |
| Product | `order.product.name` + thumbnail `order.product.image`. |
| Buyer | `order.buyer.name` + tooltip `email`. |
| Seller | `order.seller.name` + tooltip `email`. |
| Platform Fee | `order.totalAmount × 0.12` (12%). Badge. |
| Payout to Seller | `order.totalAmount × 0.88`. Badge. |
| Status | `<Tag color=.../>`. Map every ORDER_STATUS to a color. |
| Payment status | `order.payment.status`. Tag. |
| Payout status | `order.payoutStatus`. Tag. |
| Created At | `order.createdAt`. Date formatter. |
| Actions | View detail. |

**Row filters:**
- Status (multi-select, all 11 ORDER_STATUS)
- Payment status (multi-select)
- Payout status (2)
- Date range (default last 30d)
- searchTerm = searchTerm (order# / product name / buyer email / seller email via backend QueryBuilder `search(...)`)

---

## 10. Issues / Dispute Resolution

### 4 endpoints (ALL admin-only)
From [issue.route.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/issue/issue.route.ts):

```
POST   /issues                  ADMIN, SUPER_ADMIN → create issue
GET    /issues                  ADMIN, SUPER_ADMIN → list all
GET    /issues/:id              ADMIN, SUPER_ADMIN → detail
PATCH  /issues/:id/resolve      ADMIN, SUPER_ADMIN → resolve with action
```

### IssueType enum (from issue.validation.ts)
```ts
export type ISSUE_TYPE = 'buyer_refused' | 'verification_failed';
```
**These are the only 2 allowed values.** Do not invent `fraud`, `return`, etc.

### Create Issue
```
POST /issues
body: { productId: ObjectId, issueType: ISSUE_TYPE, reason: string }
```
From [issue.service.ts#L17-L81](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/issue/issue.service.ts#L17-L81):
- Cannot open if unresolved issue already exists for the same product (400).
- Side effects:
  - If product has a buyer, looks up order.
  - If order.payment.status=PAID → **auto-refunds stripe**, sets `order.payment.status=REFUNDED` (email sent to seller).
- Email sent to seller with refunded-flag + reason.

### Resolve Issue
```
PATCH /issues/:id/resolve
body: { action: 'delete' | 'make_available' }   // ⚠️ exactly these two; NOT approve/reject
```
From [issue.service.ts#L83-L148](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/issue/issue.service.ts#L83-L148):
| action | backend behavior |
|---|---|
| `'delete'` | S3 deletes `product.image` + `proofOfPurchase`. DB deletes product. |
| `'make_available'` | Sets product.status = `available`, clears `buyer`. |

Both actions:
- Set `issue.resolved = true`.
- Email seller.
- Flush product list cache.
- `issue.resolved===true` → PATCH /resolve returns 400.

### Issues Table columns
| col | source |
|---|---|
| ID | `issue._id` → link |
| Product | `issue.product.name`, thumbnail |
| Buyer / Seller | `issue.buyer?.name` / `issue.seller?.name` |
| Issue Type | Tag `issue.issueType` |
| Reason | `issue.reason` truncate + tooltip |
| Opened by | `issue.admin.name` |
| Status | `issue.resolved` green/red |
| Opened At | timestamp |
| Actions | View detail → Drawer/Modal with 2 resolve buttons. |

---

## 11. Products (Admin Catalog Moderation)

### Endpoints
From [product.route.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/product/product.route.ts):
```
GET    /products                 public (no auth)
POST   /products                 USER | ADMIN | SUPER_ADMIN   multipart
GET    /products/:id             public
PATCH  /products/:id             USER | ADMIN | SUPER_ADMIN   PURE JSON
DELETE /products/:id             USER | ADMIN | SUPER_ADMIN
```

⚠️ **Backend caveat (P2 #5):**
`PATCH /products/:id` has **NO fileUploadHandler** — it runs `validateRequest(ProductValidation.updateProductZodSchema)` on pure JSON only. That means **admin CANNOT update product images via the standard PATCH route**.

**Workaround for v1 dashboard:**
Offer a "Replace image" button that **DELETEs product + re-POSTs** (with a confirm dialog that says "This will reset buyer/seller links; only do this for unsold items").
Better: backend should add a small PATCH `/products/:id/media` with fileUploadHandler. Add this to the todo list (Back-end §16).

### Product list default query implicit filter
From [product.service.ts#L50](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/product/product.service.ts#L50):
`queryWithDefaults = { status: 'available', ...query }`

⚠️ **Admin products table MUST always send:**
```
GET /products?status=&page=1&limit=20&searchTerm=...
```
— send `status=` (empty string) or don't include status key at all **and** ensure you wrap with a `<Select defaultValue="all">` filter so admins can filter by:
- available (buyer-visible inventory)
- sold
- reserved
- etc.

Failing to override the implicit default = admin table "looks like it has no sold/reserved items." Every admin who touches it will report a bug. Flag this in code with a comment.

### Product creation multipart
From [product.service.ts#L14-L50](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/product/product.service.ts#L14-L50):
| multipart field | type | notes |
|---|---|---|
| `image` | image/jpeg, image/png, image/jpg. Max 3. ⚠️ **Only `files.image[0]` actually used** (single IProduct.image). UI can allow 3 for future-proofing but only 1 persists. |
| `doc` | application/pdf. Max 3. ⚠️ **This is proof-of-purchase.** DO NOT name the field `proofOfPurchase`. Service checks `files?.doc`. |
| (rest) | string form fields | `name, brand, category, condition, description, price, attributes{}` |

Body format: EITHER (both work, per product.route.ts middleware):
1. **Flat form entries** (recommended) — every key=value appended directly with `.append(name, value)`. `price` auto-casted to `Number`.
2. **Single `data` JSON field** — one `formData.append('data', JSON.stringify({name, price, ...}))`.

### Delete Product
Admin can do this. From service, no hard-block on linked orders — **warn UI** with confirm "Product X has N linked active orders; proceed?" (do the N lookup client-side; backend service does not guard it today).

---

## 12. Users (Admin view)

### Endpoints
From [user.route.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/user/user.route.ts):
```
GET  /user                 ADMIN | SUPER_ADMIN   → user list
POST /user                 (authLimiter + no auth)  → this is the public user register endpoint, NOT an admin create.
GET  /user/profile         USER | ADMIN | SUPER_ADMIN → own profile
PATCH /user/profile        USER | ADMIN | SUPER_ADMIN → own profile, fileUploadHandler()
DELETE /user/profile       USER | ADMIN | SUPER_ADMIN → soft via deletion
```

⚠️ **Backend caveat (P2 #6):** There is **NO admin-only `POST /user`** for creating users or admins. The public `/user POST` is the register endpoint that always sets `role = USER_ROLES.USER` (see [user.service.ts#L29-L58](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/user/user.service.ts#L29-L58)). For v1, admins are only added via the seed script. If you need to create admins from the dashboard, backend must ship a dedicated admin-user-create route.

### User list (admin GET /user)
From [user.service.ts#L13-L27](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/user/user.service.ts#L13-L27):
- QueryBuilder `search(['name','email','contact'])` — send `searchTerm`.
- Users admin table columns: Avatar, Name, Email, Contact, Role, Verified (tag), Created At, Actions (View details).
- Role tags: color-code `super_admin`, `admin`, `user`.

### User detail view
Combine 3 parallel calls:
1. `GET /user?searchTerm=<email>` — find user (or re-use user detail endpoint if backend adds one; no specific single-user detail route exists for admin today → workaround by id lookup via filter or `?email=X`)
2. `GET /orders/admin/all?buyer=<userId>` — orders as buyer
3. `GET /orders/admin/all?seller=<userId>` — orders as seller
4. `GET /products?seller=<userId>` — listed products

⚠️ No GET `/user/:id` route currently — that's P2. In v1, use QueryBuilder: `GET /user?_id=<id>&limit=1`. (Mongoose QueryBuilder.filter() matches any key, so `_id` works.)

---

## 13. Admin Own Profile (Settings → Profile)

Use the same `/user/profile` GET + PATCH + DELETE endpoints as regular users.

The PATCH `/user/profile` accepts **BOTH** multipart patterns via fileUploadHandler + middleware JSON-in-data fallback. See [user.route.ts#L17-L28](file:///c:/Development/Smart%20Shopping%20Mall/src/app/modules/user/user.route.ts#L17-L28):

| multipart field | type |
|---|---|
| `image` | jpg/png/jpeg — admin avatar. Only first used. |
| rest form fields OR single `data` JSON | `name, contact, location, password` flat fields or JSON under `data`. |

---

## 14. File Upload Rules (Backend enforces them — do NOT vary)

From [fileUploadHandler.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/app/middlewares/fileUploadHandler.ts#L9-L106):

| Field name | Mimes | Max count | Notes |
|---|---|---|---|
| `image` | jpeg, png, jpg | 3 | Singleton in DB (index 0) in Users & Products |
| `media` | video/mp4, audio/mpeg, audio/mp3 | 3 | Reserved; no admin route consumes this yet |
| `doc`   | application/pdf | 3 | Product proofOfPurchase. Must not rename. |

**Any other field name → backend returns 400.** Don't invent `avatar`, `photo`, `files`, etc. The handler rejects them explicitly.

---

## 15. Error Messages Mapping — UX Presentation

Backend error shape — from [globalErrorHandler.ts](file:///c:/Development/Smart%20Shopping%20Mall/src/app/middlewares/globalErrorHandler.ts#L1-L73):

```json
{
  "success": false,
  "message": "A human-readable headline",
  "errorMessages": [{ "path": "password", "message": "Must be at least 8 chars" }, ...],
  "stack": "...only in DEV"
}
```

| Backend throws | resulting shape | UI handling |
|---|---|---|
| Zod validation error (validateRequest middleware) | `errorMessages[]` with `path[] → string path` | Map every path → Ant Design `form.setErrors`. |
| Mongoose ValidationError | `errorMessages[]` with same `path, message` | Same |
| `jwt.TokenExpiredError` | `message: "jwt expired"` OR "TokenExpiredError" → HTTP 401 | Refresh + retry (interceptor §3 handles). |
| `ApiError(code, msg)` | `message` only, no errorMessages | `message.error(msg)` toast. |
| 500 unknown `Error` | `message: err.message`, `stack` | "Something went wrong" + capture to Sentry. |

### Global toast wrapper
```ts
// src/lib/notify.ts
import { message as antdMessage } from 'antd';
import type { AxiosError } from 'axios';
import type { ApiErrorShape } from './http';

export function toastApiError(err: unknown, fallback = 'Request failed') {
  const response = (err as AxiosError<ApiErrorShape>)?.response?.data;
  const title = response?.message ?? fallback;
  antdMessage.error({ content: title, duration: 4 });
  if (response?.errorMessages?.length) {
    for (const e of response.errorMessages.slice(0, 3)) {
      antdMessage.warning({ content: `${e.path}: ${e.message}`, duration: 5 });
    }
  }
}
```

---

## 16. Backend Fix Suggestions (P0 → P3 priority for your backend team)

For admin dash v1 we've documented client-side workarounds for every one of these, but they should ship as soon as possible.

| Priority | # | Gap | Impact to Admin dash today | Workaround in admin web |
|---|---|---|---|---|
| **P1** | 1 | `GET /stats` aggregate endpoint missing | Dashboard KPIs make 4 parallel bloated list queries (O(N) download) every 5 min. | High staleTime + `limit=2000` client-side reduce. |
| **P1** | 2 | Socket.IO emits zero business events | Live ops-refresh doesn't work. | 30s interval polling on orders/issues tables. |
| **P1** | 3 | No `GET /user/:id` route for admins | User detail needs `_id=` QueryBuilder hack + parallel calls. | `GET /user?_id=<id>&limit=1`. |
| **P2** | 4 | ADMIN / SUPER_ADMIN permission gates are identical; the super_admin role has no extra power. Defer fine-grained feature gating. | Role switcher in sidebar has no effect. | Remove role switcher; display "role badge" only. |
| **P2** | 5 | `PATCH /products/:id` has no fileUploadHandler — product images can't be updated in-place | Admin "Edit product image" would require DELETE + re-POST. | Modal warning + DELETE/POST workaround. |
| **P2** | 6 | No admin-only endpoint to create users/admins (`POST /user` is public register and overrides role→USER) | Can't onboard new ops staff from UI. | Backend seed script only. |
| **P2** | 7 | No `/orders/:id/statusHistory` paginated endpoint. Currently statusHistory is part of the order doc array only. | For long-running orders it's fine. Flag later. | N/A — access via `order.statusHistory[]`. |
| **P3** | 8 | Reset-password token is in `Authorization` **RAW** (no Bearer prefix) — inconsistency | Requires interceptor if-statement. | Documented + handled (§3). |

---

## 17. Full API Reference (Admin-only routes)

Base URL: `/api/v1` (see [app.ts#L62](file:///c:/Development/Smart%20Shopping%20Mall/src/app.ts#L62)).

All admin routes are pre-gated with `auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN)` unless marked otherwise.

### Users
| Method | Route | Role | Body | Response |
|---|---|---|---|---|
| GET | `/user` | ADMIN / SA | query: `page, limit, searchTerm, role, verified, sort, fields` | `data: { result: User[], meta: pagination }` |
| GET | `/user/profile` | any authenticated | — | `data: User` (own profile) |
| PATCH | `/user/profile` | any authenticated | multipart: `image`? + flat or `data` JSON | `data: User` updated |

### Products
| Method | Route | Role | Body | Response |
|---|---|---|---|---|
| GET | `/products` | **public** | query: `page, limit, searchTerm, status, category, brand, seller, sort` | `{data:{result, meta}}`. ⚠️ Defaults `status=available` if omitted. |
| POST | `/products` | USER / ADMIN / SA | multipart: `image` + optional `doc` + flat or JSON-in-`data` | `data: Product` |
| PATCH | `/products/:id` | USER / ADMIN / SA | JSON only (no file upload) | `data: Product` |
| DELETE | `/products/:id` | USER / ADMIN / SA | — | success message |

### Orders
| Method | Route | Role | Body / Query | Response |
|---|---|---|---|---|
| GET | `/orders/admin/all` | ADMIN / SA | query: `page, limit, searchTerm, status, payoutStatus, buyer, seller, sort` | `{data:{result: OrderPopulated[], meta}}` |
| PATCH | `/orders/:id/status` | ADMIN / SA | `{status: ORDER_STATUS, note?: string}` | `data: Order` with updated statusHistory |
| PATCH | `/orders/:id/payout` | ADMIN / SA | `{}` | `data: Order` payoutStatus = PAID |
| GET | `/orders/:id` | USER (owner) / ADMIN / SA | — | `data: Order` |

### Issues (all admin-only)
| Method | Route | Role | Body / Query | Response |
|---|---|---|---|---|
| POST | `/issues` | ADMIN / SA | `{productId, issueType:'buyer_refused'\|'verification_failed', reason}` | `data: Issue`. Auto-refund if order paid. |
| GET | `/issues` | ADMIN / SA | — | `data: Issue[]` sorted newest first, populated product/seller/buyer/admin. |
| GET | `/issues/:id` | ADMIN / SA | — | `data: Issue` populated |
| PATCH | `/issues/:id/resolve` | ADMIN / SA | `{action: 'delete' \| 'make_available'}` | `data: Issue` resolved=true. |

### Auth (relevant to admin)
| Method | Route | Auth | Body / Headers | Response |
|---|---|---|---|---|
| POST | `/auth/login` | — | `{email, password}` | `{data:{accessToken, refreshToken, user}}` |
| POST | `/auth/refresh-token` | **Bearer `<refreshToken>`** | — | `{data:{accessToken, refreshToken}}` |
| POST | `/auth/logout` | — | — | (if exists) clear tokens. No backend blacklist today. |

---

## 18. Performance Rules — Non-negotiable

1. **Stale-time for list queries:**
   - `/orders/admin/all` → `staleTime: 60_000` (60s)
   - `/issues` → `staleTime: 120_000`
   - `/user` (admin list) → `staleTime: 300_000`
   - `/products` → `staleTime: 60_000`
2. **Dedupe fetches** — use TanStack Query `queryKey` arrays that include every filter/sort/page param. Never do manual `useEffect` loops.
3. **Pagination via server** — don't fetch `limit=5000` then client-page; keep limit ≤ 50.
4. **Defer heavy aggregate KPIs** with `<Skeleton active>`; show cached value on first paint.
5. **Debounce searchTerm input** — 300ms debounce before updating URL params.
6. **Avoid loading heavy Mongoose populated models on huge pages** — use `fields` query param for table-only calls if payload gets too heavy.
7. **Ant Design Table `rowKey="_id"`** — always set explicitly; React needs stable keys.

---

## 19. Testing Strategy for Admin Dashboard

1. **Unit (Vitest):**
   - ORDER_STATUS_TRANSITIONS table (mirror backend to catch drift).
   - HTTP interceptor refresh-lock behavior.
   - `toastApiError` mapping.
2. **Component tests (Vitest + RTL):**
   - Order Status Stepper → only valid buttons enabled per current status.
   - Issues Resolve drawer → 2 action buttons only.
   - Data table skeleton + pagination.
3. **E2E (Playwright):**
   - Critical path: `login → orders table → open order → transition SECURED → COLLECTION_PENDING → mark note`
   - Critical path: `issues → create → resolve delete`
   - Guard: `unauthenticated /dashboard redirect → /login`
4. **Visual regression** (Playwright screenshots) on KPI cards + Steps.

---

*This guideline is version-controlled. Update §17, §16, and the version header (top of file) whenever the backend ships changes. Do not let the guideline drift from the source of truth — re-run the audit when in doubt.*
