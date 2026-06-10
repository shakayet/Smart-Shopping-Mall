# Closeté – Architecture & Implementation Plan

Status: **DRAFT FOR REVIEW – no implementation started**

---

## 1. Project Understanding (from Figma)

The Figma file ("Closete UI Design File") describes a **luxury resale marketplace mobile app** ("Closeté") plus a **separate web-based Operations/Admin dashboard**. Two user-facing surfaces:

### A. Mobile App (Buyer/Seller — same user role)

| Flow | Screens | Backend implication |
|---|---|---|
| **Onboarding** | OB34–36 (feed scroll, "Sell in 60 seconds", "Shop with Confidence") | Static content, no backend needed |
| **Auth** | Sign Up (first name, last name, email), Verify Email (OTP, resend) | Already exists (`auth`, `user` modules) — needs first/last name split |
| **Home / Discover** | Feed of products (image, seller, price, like) | Already exists (`GET /products`) |
| **Product View** | Image/video, seller info, description, "Secure This Item" | Exists (`GET /products/:id`) — needs video field, trust badges |
| **Wishlist** | Empty state + grid of saved items, white/red heart toggle | **New module**: `wishlist` |
| **Sell Flow** | Camera capture (photo/video) → AI "Analyzing brand…" → AI error/retry → Review Listing (AI-filled: brand, description, suggested price, condition) → Price validation error → Post Item → "Your item is live" with earnings breakdown (listing price, Closeté fee 12%, seller earnings) | **New**: AI analysis endpoint, extend `product` model with AI fields, fee calculation |
| **Checkout / Payment** | Secure item (delivery address form) → Payment method (Apple Pay / Google Pay / Card / saved cards) → Add new card → Payment error/retry → Order Confirmation with delivery status timeline | **New module**: `order` + `payment`, integrate payment gateway (Stripe recommended) |
| **My Profile** | Profile header (items listed, purchases, closet value) → Tabs: My Wardrobe / My Purchases / Personal Details | Extend `user`, new `order` queries |
| **Item Detail (seller view)** | Status workflow: Not Reserved → Reserved → Collected → Authenticating (pass/fail) → Delivered/Rejected/Sold, buyer details, earnings/payout, "Sell Again" | `order` status machine + payout tracking |
| **Order Detail (buyer view)** | Same status timeline, seller details, "Contact Support" | `order` read endpoint |
| **Terms & Conditions** | Static legal text | Static content (config or simple CMS endpoint) |

### B. Operations / Admin Web Dashboard

| Flow | Screens | Backend implication |
|---|---|---|
| **Login** | Username/password, "Reserved access for authorized operations staff" | Reuse `auth` login, restrict by role |
| **Active Operations** | Orders table (Awaiting Collection, Collected, Verified, Delivered, Issues), search, date filter | New `order` admin list/filter endpoints |
| **Order Detail panel** | Item info, pickup/delivery time, seller & buyer contact, status timeline, "Mark As Collected", "Report an Issue" | Order status transition endpoints |
| **Report Issue** | Issue type (failed verification, seller unavailable, buyer rejected + reason, other) → "Issue reported" | New `issue`/`dispute` sub-resource on order |
| **Order updated (Approved/Rejected)** | Triggers refund/return flow | Order status + refund integration |

### Core Domain Concepts Identified

1. **Listing lifecycle**: `draft (AI analyzing)` → `available` → `reserved/secured` → `collected` → `authenticating` → `authenticated` / `rejected` → `out_for_delivery` → `delivered` / `sold`
2. **Two-sided marketplace**: every user can be buyer and seller; every `Order` links a `buyer`, `seller`, `product`.
3. **Trust & authentication workflow**: items are physically inspected by ops staff before being released to buyers (escrow-like model).
4. **Fee model**: Closeté takes a % commission (shown as 12% in mockups) — seller earnings = listing price − fee.
5. **AI assistance**: brand/condition recognition + suggested price from photo/video (third-party AI vision service — see Assumptions).
6. **Payments**: card + wallet (Apple Pay/Google Pay) — held until item passes authentication ("Payment protected until you receive it").

---

## 2. Proposed Frontend Architecture (context only — separate repo)

> This repo is backend-only, but documenting expectations helps API design.

- **Mobile app**: React Native / Flutter (not in this repo). Consumes REST API + Socket.io for real-time order status updates.
- **Admin dashboard**: React (Vite) SPA, role-gated (`ADMIN` / `SUPER_ADMIN` or new `OPERATIONS` role), consumes the same REST API under `/api/v1/admin/*`.
- State management: React Query/TanStack Query for server state (works well with REST + pagination patterns already in `QueryBuilder`); Socket.io client for live order status.

---

## 3. Proposed Backend Architecture

Keep the **existing modular pattern** (`module.controller.ts`, `.service.ts`, `.model.ts`, `.interface.ts`, `.route.ts`, `.validation.ts`) — no change to conventions, just extend it.

### New/Extended Modules

```
src/app/modules/
├── auth/            (existing — minor extension: split name → firstName/lastName)
├── user/            (existing — extend interface: address fields, closetValue/stats)
├── product/         (existing — extend: video, AI fields, category, size)
├── wishlist/        (NEW)
├── order/           (NEW — core checkout + status workflow)
├── payment/         (NEW — payment method + payment intent handling via Stripe)
├── ai/              (NEW — brand/condition/price analysis via external AI service)
├── issue/           (NEW — dispute/report-issue sub-resource of order)
└── admin/           (NEW — ops dashboard aggregation endpoints, or folded into order/issue with role guards)
```

### Cross-cutting additions
- `src/enums/order.ts` — order status, issue type enums
- `src/enums/product.ts` — move product status enum out of inline strings
- `src/integrations/stripe.ts` (or `helpers/paymentHelper.ts`) — payment gateway wrapper
- `src/integrations/aiVision.ts` — AI image-analysis wrapper
- Extend `socketHelper.ts` to emit `order:status_updated` events to buyer & seller rooms

---

## 4. Database / Model Structure

### 4.1 `User` (extend existing)
```ts
{
  firstName: string;
  lastName: string;
  name: string;          // keep as derived/display name for backward compat, or deprecate
  email: string;
  password: string;
  role: USER_ROLES;       // add OPERATIONS? (see open questions)
  address?: string;
  city?: string;
  country?: string;
  contact?: string;
  avatar?: string;
  status: 'active' | 'ban';
  verified: boolean;
  authentication: {...};  // unchanged
  // derived stats (computed, not stored): itemsListed, purchasesCount, closetValue
}
```

### 4.2 `Product` (extend existing)
```ts
{
  name: string;
  images: string[];        // was single `image` — support multiple + video
  video?: string;
  brand: string;
  category?: string;
  size?: string;
  description: string;
  price: number;            // final listing price
  aiSuggestedPrice?: number;
  aiCondition?: string;
  aiAnalysisStatus: 'pending' | 'completed' | 'failed';
  condition: string;
  proofOfPurchase?: string;
  status: 'draft' | 'available' | 'reserved' | 'sold' | 'removed';
  seller: ObjectId;
}
```

### 4.3 `Wishlist` (new)
```ts
{
  user: ObjectId;
  product: ObjectId;
  createdAt: Date;
}
// unique compound index on (user, product)
```

### 4.4 `Order` (new — the core entity)
```ts
{
  orderNumber: string;       // human-readable e.g. #347892
  product: ObjectId;
  buyer: ObjectId;
  seller: ObjectId;
  price: number;
  closeteFee: number;        // computed at creation (12%)
  sellerEarning: number;
  deliveryDetails: {
    firstName: string;
    lastName: string;
    address: string;
    city: string;
    country: string;
    phone: string;
  };
  payment: {
    paymentIntentId: string;   // Stripe PaymentIntent
    method: 'card' | 'apple_pay' | 'google_pay';
    status: 'pending' | 'authorized' | 'captured' | 'failed' | 'refunded';
  };
  status: OrderStatus;        // see enum below
  statusHistory: { status: OrderStatus; note?: string; changedAt: Date; changedBy: ObjectId }[];
  estimatedDeliveryDate?: Date;
}
```

`OrderStatus` enum:
```
RESERVED -> COLLECTED -> AUTHENTICATING -> AUTHENTICATED -> OUT_FOR_DELIVERY -> DELIVERED
                                     \-> AUTHENTICATION_FAILED -> REFUNDED
                              -> BUYER_REJECTED -> REFUNDED
```

### 4.5 `PaymentMethod` (new — saved cards)
```ts
{
  user: ObjectId;
  provider: 'stripe';
  providerCustomerId: string;
  providerPaymentMethodId: string;  // tokenized — never store raw card data
  brand: string;       // visa/mastercard
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}
```

### 4.6 `Issue` (new — for "Report Issue" / disputes)
```ts
{
  order: ObjectId;
  reportedBy: ObjectId;       // ops staff
  type: 'failed_verification' | 'seller_unavailable' | 'buyer_rejected' | 'other';
  reason?: string;            // e.g. "Changed mind", "Condition issue", "Not as described"
  details?: string;
  resolution?: 'approved' | 'rejected';
  status: 'open' | 'resolved';
}
```

### 4.7 `ResetToken` — unchanged

---

## 5. API Endpoint Planning

### Auth (existing — minor additions)
- `POST /auth/register` *(currently under `/user`)* — add firstName/lastName
- existing login/forget/verify/reset/change-password/refresh-token unchanged

### Product / Listing
- `GET /products` — existing (filters: category, brand, price range, search)
- `GET /products/:id` — existing
- `POST /products` — existing, extend to accept multiple images + video
- `PATCH /products/:id`, `DELETE /products/:id` — existing
- `POST /products/:id/secure` — existing "secure item" → renamed conceptually to **create order** (see Order module)

### AI Analysis (new)
- `POST /ai/analyze-listing` — multipart photo/video upload → returns `{ brand, condition, suggestedPrice, description }`
- Used during "Sell" flow before Review Listing screen

### Wishlist (new)
- `GET /wishlist` — current user's wishlist
- `POST /wishlist/:productId` — add
- `DELETE /wishlist/:productId` — remove

### Order (new)
- `POST /orders` — create order from product (replaces `secure/:id`); body = delivery details + paymentMethodId
- `GET /orders` — current user's orders (as buyer) — `?role=buyer|seller`
- `GET /orders/:id` — order detail (buyer or seller or admin)
- `PATCH /orders/:id/status` — admin-only status transitions (Mark As Collected, Authenticated, Out for Delivery, Delivered)
- `POST /orders/:id/cancel` — buyer cancel (only while `RESERVED`)

### Payment (new)
- `GET /payment-methods` — list saved cards
- `POST /payment-methods` — add card (via Stripe SetupIntent → save token)
- `DELETE /payment-methods/:id`
- `POST /payment-methods/intent` — create PaymentIntent for an order (Apple Pay/Google Pay/card)
- `POST /payment/webhook` — Stripe webhook (payment success/failure → update order.payment.status)

### Issue / Disputes (new, admin-facing)
- `POST /orders/:id/issues` — report issue (ops dashboard)
- `PATCH /issues/:id` — resolve (approve/reject → triggers refund)

### Admin / Operations Dashboard (new, role-gated)
- `GET /admin/orders` — paginated, filterable by status (Awaiting Collection / Collected / Verified / Delivered / Issues), search, date range
- `GET /admin/orders/:id` — full order detail incl. seller/buyer contact
- (status transitions reuse `PATCH /orders/:id/status` and issue endpoints above with admin auth)

### User / Profile (extend existing)
- `GET /user/profile` — existing, extend response with `itemsListed`, `purchasesCount`, `closetValue` (aggregated)
- `PATCH /user/profile` — existing, add address fields
- `GET /user/wardrobe` — seller's listed products with status
- `GET /user/purchases` — buyer's orders

---

## 6. Folder / Module Structure (proposed additions)

```
src/
├── app/modules/
│   ├── wishlist/
│   │   ├── wishlist.controller.ts
│   │   ├── wishlist.interface.ts
│   │   ├── wishlist.model.ts
│   │   ├── wishlist.route.ts
│   │   └── wishlist.service.ts
│   ├── order/
│   │   ├── order.controller.ts
│   │   ├── order.interface.ts
│   │   ├── order.model.ts
│   │   ├── order.route.ts
│   │   ├── order.service.ts
│   │   └── order.validation.ts
│   ├── payment/
│   │   ├── payment.controller.ts
│   │   ├── paymentMethod.model.ts
│   │   ├── payment.route.ts
│   │   └── payment.service.ts
│   ├── ai/
│   │   ├── ai.controller.ts
│   │   ├── ai.route.ts
│   │   └── ai.service.ts
│   └── issue/
│       ├── issue.controller.ts
│       ├── issue.interface.ts
│       ├── issue.model.ts
│       ├── issue.route.ts
│       └── issue.service.ts
├── enums/
│   ├── order.ts        (OrderStatus, IssueType)
│   └── product.ts       (ProductStatus, ProductCategory)
├── integrations/
│   ├── stripe.ts
│   └── aiVision.ts
└── routes/index.ts        (register new routes)
```

---

## 7. Authentication & Role-Based Access

Existing roles: `SUPER_ADMIN`, `ADMIN`, `USER`. Existing `auth(...)` middleware already supports role lists.

Proposal:
- Keep `USER` for all mobile app users (buyer = seller = same role).
- Ops dashboard: reuse `ADMIN` / `SUPER_ADMIN` — **add `OPERATIONS` role** if ops staff need a distinct, narrower permission set (can view/manage orders & issues but not manage admins/users). Recommend adding `OPERATIONS` for least-privilege.
- New endpoint guards:
  - `/admin/*` → `auth(USER_ROLES.OPERATIONS, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN)`
  - `/orders/:id/status` (PATCH) → ops/admin only
  - `/orders` (POST, create) → `USER` (existing `authForBuy` pattern reused)
  - `/issues` → ops/admin only

---

## 8. State Management / Data Flow

(Frontend concern, but backend must support it)

- **REST** for CRUD (products, wishlist, orders, profile).
- **Socket.io** (already scaffolded) for real-time order status push:
  - On status transition, emit to `user:<buyerId>` and `user:<sellerId>` rooms: `order:status_updated`.
  - Admin dashboard subscribes to `admin:orders` room for live table updates.
- **Pagination/filtering**: continue using existing `QueryBuilder` for products, orders, admin order list.

---

## 9. Scalability & Performance Considerations

- Index `Order.status`, `Order.buyer`, `Order.seller`, `Product.status`, `Product.seller`, `Wishlist.(user, product)` (unique compound).
- Move file uploads (images/video/proof docs) directly to S3 via presigned URLs for large video files instead of multer-disk → S3 relay, to reduce server load.
- AI analysis (brand/price detection) should be **async**: accept upload, return job id, process in background (queue — e.g., BullMQ + Redis) and notify via socket when done — matches the "Analyzing brand…" loading screen UX and avoids blocking request threads on slow AI calls.
- Cache product feed (`GET /products`) with short TTL (Redis) given high read volume on Home screen.
- Stripe webhooks must be idempotent (store processed event IDs).

---

## 10. Security Best Practices

- Never store raw card numbers — use Stripe tokens/PaymentMethod IDs only (already planned above).
- Verify Stripe webhook signatures (`stripe-signature` header + webhook secret).
- Rate-limit auth endpoints (login, OTP resend/verify) — not currently present, recommend `express-rate-limit`.
- Validate all file uploads (mime-type, size limits) — `fileUploadHandler` exists, ensure limits enforced for video.
- RBAC checks at route + service layer (defense in depth) — existing pattern in `product.service.ts` (seller/admin check) should be replicated for `order`/`issue`.
- Sanitize/validate delivery address & phone via Zod (`order.validation.ts`).
- Ensure `PaymentMethod` documents are scoped to `req.user.id` on every query.

---

## 11. Development Phases & Roadmap

**Phase 1 — Foundations**
- Extend `User` (firstName/lastName, address fields) and `Product` (images array, video, category, size, AI fields)
- `enums/order.ts`, `enums/product.ts`

**Phase 2 — Wishlist**
- Full CRUD module (small, low-risk, good warm-up)

**Phase 3 — Order & Checkout Core**
- `Order` model + status enum/state machine
- `POST /orders` (replaces `secure/:id`), `GET /orders`, `GET /orders/:id`
- Fee calculation logic (12% commission)

**Phase 4 — Payments**
- Stripe integration: PaymentMethod CRUD, PaymentIntent creation, webhook handler
- Wire into order creation flow (authorize → capture on delivery confirmation, or capture immediately per business rule — **needs clarification**)

**Phase 5 — AI Listing Assistant**
- `POST /ai/analyze-listing` integration with chosen vision provider
- Async job + socket notification for "Analyzing brand…" UX

**Phase 6 — Admin/Operations Dashboard APIs**
- `OPERATIONS` role, `/admin/orders` endpoints, status transitions, issue reporting/resolution, refund trigger

**Phase 7 — Profile Aggregations & Polish**
- `closetValue`, `itemsListed`, `purchasesCount` aggregation endpoints
- Real-time socket events for order status across buyer/seller/admin
- Rate limiting, webhook hardening, indexes

---

## 12. Risks, Assumptions & Open Questions

1. **Payment gateway choice**: Plan assumes **Stripe** (best support for Apple Pay/Google Pay/cards + webhooks). Confirm this is acceptable, or specify an alternative (e.g., regional provider for AED/UAE — Stripe support in UAE is limited; **Telr, PayTabs, or Network International** may be more appropriate given AED currency in mockups). **This materially affects the payment module — needs a decision before Phase 4.**
2. **AI vision provider**: Plan assumes an external API (e.g., OpenAI Vision, Google Cloud Vision) for brand/condition/price detection. Need to confirm provider, cost constraints, and whether `tesseract.js` (already a dependency) is meant to cover OCR for proof-of-purchase docs only (likely yes) vs. brand detection (likely needs a different model).
3. **Escrow / payment timing**: Mockups say "Payment protected until you receive it" — implies **authorize-now, capture-on-delivery-confirmation** (or capture-on-authentication-pass). Need confirmation of exact capture trigger and refund rules for `AUTHENTICATION_FAILED` / `BUYER_REJECTED`.
4. **Roles for ops dashboard**: Recommend new `OPERATIONS` role vs. reusing `ADMIN`. Needs decision — affects `enums/user.ts` and `auth` middleware usage across new routes.
5. **"name" field split**: Existing `User.name` is a single field; Figma sign-up shows separate First/Last name. Plan proposes adding `firstName`/`lastName` and deriving `name` — confirm whether `name` should be deprecated or kept for backward compatibility with existing data.
6. **Multi-image/video for products**: current `Product.image` is a single string + `proofOfPurchase`. Figma shows video playback on product cards. Plan proposes `images: string[]` + `video?: string` — confirm storage/CDN approach (S3 + CloudFront already configured, should be fine).
7. **Delivery/logistics**: No courier/logistics integration is visible in Figma beyond status labels — assuming all "Collected/Out for Delivery/Delivered" transitions are **manually triggered by ops staff** via the dashboard (no third-party courier API). Confirm.
8. **Notifications**: Figma doesn't show push notifications explicitly, but "Resend code in 00:45" and live status updates suggest at least email (existing `emailHelper`) + in-app via Socket.io. Confirm if push notifications (FCM/APNs) are in scope — not currently a dependency.

---

*No code has been written yet. Awaiting your review/confirmation on the open questions in Section 12, especially #1 (payment provider), #3 (escrow/capture timing), and #4 (roles) before starting Phase 1.*
