# Smart Shopping Mall API

## Production checks

```sh
npm ci
npm run check
```

Copy `.env.example` to the deployment secret manager and replace every placeholder.
The process fails at startup if required configuration is absent or unsafe.

Use `/health/live` for liveness and `/health/ready` for readiness. Configure the
load balancer to terminate TLS and preserve the forwarding headers. Run at least
Node.js 22 and MongoDB as a replica set with backups and monitoring.

## OAuth callback migration

The Google callback redirects to `FRONTEND_OAUTH_CALLBACK_URL?code=...`. The
frontend must immediately POST the code as JSON to `/api/v1/oauth/exchange`.
The one-time code expires after 60 seconds and is consumed by the first exchange.
JWTs are never placed in redirect URLs.

## Deployment

Build with the included multi-stage `Dockerfile`. Mount writable ephemeral
directories for `uploads` and `winston`, or ship logs to stdout through the
platform. Product assets are uploaded to S3; only locally stored profile images
are publicly exposed.

Configure Stripe to deliver `payment_intent.succeeded` and
`payment_intent.payment_failed` to `/api/v1/payment/webhook`. Use a unique
production webhook secret and alert on non-2xx delivery attempts.

## Stripe Connect seller payouts

Sellers use `POST /api/v1/payment/connect/onboarding` to obtain a Stripe-hosted
Express onboarding URL. The API owns the signed Stripe return and refresh URLs,
so mobile clients do not need public web callback pages. The app can query
`GET /api/v1/payment/connect/status` after the Stripe browser flow closes.

The platform uses UAE Express accounts and separate charges and transfers.
Buyer funds remain on the platform while the item is verified. Moving an order
to `payout_processing` creates the real, idempotent Stripe transfer to the
seller; it fails safely if onboarding or payouts are incomplete. Refunds after
a transfer reverse the seller transfer before refunding the buyer.

Before launch, run a staging smoke test covering account creation, OTP login,
Google OAuth exchange, simultaneous checkout attempts, successful payment,
failed payment, cancellation/refund, and admin issue resolution.
