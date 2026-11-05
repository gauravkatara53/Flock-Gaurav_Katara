# Urja Meter Ops API Service (Phase 1)

A clean, maintainable, production-ready backend service built on Node.js, Express, and TypeScript over the Urja Meter Ops portal (`https://urja-ops.flockenergy.tech`).

---

## 1. Project Overview

The **Urja Meter Ops API Service** serves as a structured REST API layer over the Urja Meter Ops SvelteKit application. It bridges the gap between external consumers and the internal portal services, abstracting session lifecycle management, request signing, rate limiting, and data normalization.

### Phase 1 Scope
- **Backend Foundation**: Production TypeScript project with Zod configuration validation, structured logging with secret redaction, and centralized error handling.
- **Resilient Portal Client**: Reusable HTTP client leveraging Axios and `tough-cookie` for automated cookie jar management across requests.
- **Authentication Service**: Robust Better Auth session cookie (`__Secure-better-auth.session_token`) management, session validation, active caching, and decoupled login interfaces.
- **Core APIs**: `/api/v1/health` and `/api/v1/portal/status`.
- **100% Mocked Automated Test Suite**: Full test coverage across environment validation, client initialization, cookie persistence, session verification, and network error handling without making unauthorized live portal calls.

---

## 2. Technology Stack

- **Runtime**: [Node.js](https://nodejs.org/) (v20+ / v22+)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (ES2022)
- **Web Framework**: [Express.js](https://expressjs.com/)
- **HTTP Client**: [Axios](https://axios-http.com/) with [`axios-cookiejar-support`](https://github.com/3846masa/axios-cookiejar-support)
- **Cookie Jar**: [`tough-cookie`](https://github.com/salesforce/tough-cookie) (v5+)
- **Configuration & Validation**: [Zod](https://zod.dev/) & [dotenv](https://github.com/motdotla/dotenv)
- **Testing Framework**: [Vitest](https://vitest.dev/)
- **API Testing**: [Supertest](https://github.com/ladjs/supertest)
- **Package Manager**: [npm](https://www.npmjs.com/)

---

## 3. Architecture

The service follows a layered architecture with strict separation of concerns:

```
┌────────────────────────────────────────────────────────┐
│                   Incoming HTTP Client                 │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Express Router                       │
│    (/api/v1/health, /api/v1/portal/status)             │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Service Layer                        │
│            (AuthService, future Meter/DT services)     │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                Portal HTTP Client                      │
│     (Axios + tough-cookie jar + Error Normalizer)      │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│          Urja Meter Ops Portal (SvelteKit)             │
│        https://urja-ops.flockenergy.tech               │
└────────────────────────────────────────────────────────┘
```

### Architectural Highlights
1. **Network & Portal Isolation**: Routes never interface directly with Axios or network sockets. All portal communication is routed through dedicated domain services and the encapsulated `PortalClient`.
2. **Session Cookie Jar**: `tough-cookie` stores and persists session cookies across subsequent requests.
3. **Secret Redaction**: Logs automatically scrub sensitive keys (`password`, `authorization`, `cookie`, `set-cookie`, `__Secure-better-auth.session_token`, `x-signature`) from log lines.
4. **Standardized Error Handling**: Errors from network failures, timeouts, authentication drops, and invalid configurations are converted into standard `AppError` instances with deterministic HTTP status codes.

---

## 4. Directory Structure

```text
urja-meter-api/
├── src/
│   ├── config/
│   │   └── env.ts                # Zod environment schema & fail-fast validation
│   ├── clients/
│   │   └── portal.client.ts      # Axios + tough-cookie reusable client
│   ├── services/
│   │   └── auth.service.ts       # Better Auth session & lifecycle management
│   ├── middleware/
│   │   └── error.middleware.ts   # Centralized error & 404 middleware
│   ├── routes/
│   │   ├── health.routes.ts      # GET /api/v1/health
│   │   └── portal.routes.ts      # GET /api/v1/portal/status
│   ├── utils/
│   │   └── logger.ts             # Structured logging with secret redaction
│   ├── types/
│   │   └── portal.types.ts       # Portal schemas, types, and AppError class
│   ├── app.ts                    # Express application factory
│   └── server.ts                 # Server entrypoint and graceful shutdown
├── tests/
│   ├── health.test.ts            # Health route & 404 test suite
│   ├── auth.test.ts              # Authentication & status integration tests
│   └── portal-client.test.ts     # Client initialization, cookies & normalization
├── .env.example                  # Template environment variables
├── .gitignore                    # Git ignore file
├── package.json                  # Dependencies & scripts
├── tsconfig.json                 # TypeScript compiler configuration
├── vitest.config.ts              # Vitest test configuration
└── README.md                     # Documentation
```

---

## 5. Installation & Environment Setup

### Prerequisites
- Node.js >= 20.x or 22.x
- npm >= 10.x

### Installation
Clone the repository and install dependencies:

```bash
cd urja-meter-api
npm install
```

### Environment Configuration
Copy the template configuration file:

```bash
cp .env.example .env
```

Edit `.env` to provide your configuration:

```env
# Server Port
PORT=3000

# Environment Mode (development | production | test)
NODE_ENV=development

# Portal Base URL
PORTAL_BASE_URL=https://urja-ops.flockenergy.tech

# Portal Credentials (Optional in Phase 1)
PORTAL_USERNAME=
PORTAL_PASSWORD=

# Portal Request Timeout in Milliseconds
PORTAL_TIMEOUT_MS=10000

# Better Auth Session Token (Optional pre-authenticated session)
PORTAL_SESSION_TOKEN=
```

---

## 6. Development & Build Commands

| Command | Action |
|---|---|
| `npm run dev` | Starts the server in development watch mode using `tsx` |
| `npm run build` | Compiles TypeScript into `./dist` |
| `npm start` | Runs the compiled production server from `./dist/server.js` |
| `npm test` | Executes all Vitest unit and integration test suites |
| `npm run test:coverage` | Runs tests and prints code coverage report |

---

## 7. Authentication Architecture

The Urja Meter Ops portal is built with **SvelteKit** and uses **Better Auth**.

### Better Auth Integration
- **Cookie Strategy**: Better Auth sets the session token in the cookie:
  - Production (HTTPS): `__Secure-better-auth.session_token`
  - Development (HTTP): `better-auth.session_token`
- **Session Verification**: The `AuthService` verifies authentication status by checking cookie presence and performing a lightweight validation against the verified `/portal/meters/search?q=&page=1` endpoint.
- **Cache Layer**: Validation results are cached in-memory with a 30-second TTL to avoid spamming the portal with redundant validation requests on high-frequency API calls.
- **Login Abstraction**: In compliance with Phase 1 constraints (*"Do not invent a login endpoint or request payload. If a specific login detail is unavailable, implement the remaining architecture and isolate authentication behind a clearly documented interface"*), the `AuthService.login()` interface is isolated behind `IAuthService` and raises a descriptive `PORTAL_AUTH_FAILED` (501 Not Implemented) until the payload schema is verified. Active sessions can be provided via `PORTAL_SESSION_TOKEN` in `.env` or set via `authService.setSessionToken(token)`.

---

## 8. API Specification & Sample Requests

### 1. Service Health Check

Returns the operational health of the REST API. This endpoint runs independently of portal connectivity or authentication.

- **URL**: `GET /api/v1/health`
- **Headers**: `Accept: application/json`

**Sample Request**:
```bash
curl -X GET http://localhost:3000/api/v1/health
```

**Success Response (HTTP 200)**:
```json
{
  "success": true,
  "service": "urja-meter-api",
  "status": "healthy"
}
```

---

### 2. Portal Session Status

Inspects whether the active service session is authenticated with the Urja Meter Ops portal.

- **URL**: `GET /api/v1/portal/status`
- **Query Parameters**:
  - `force` (optional, boolean): Set to `true` to bypass the 30-second cached session status.
- **Headers**: `Accept: application/json`

**Sample Request**:
```bash
curl -X GET http://localhost:3000/api/v1/portal/status
```

**Response (Authenticated - HTTP 200)**:
```json
{
  "success": true,
  "portal": "Urja Meter Ops",
  "authenticated": true
}
```

**Response (Unauthenticated - HTTP 200)**:
```json
{
  "success": true,
  "portal": "Urja Meter Ops",
  "authenticated": false
}
```

**Response (Portal Timeout - HTTP 504)**:
```json
{
  "success": false,
  "error": {
    "code": "PORTAL_TIMEOUT",
    "message": "Urja Meter Ops portal request timed out"
  }
}
```

**Response (Portal Unavailable - HTTP 503)**:
```json
{
  "success": false,
  "error": {
    "code": "PORTAL_UNAVAILABLE",
    "message": "Urja Meter Ops portal is unavailable or unreachable"
  }
}
```

---

## 9. Error Codes & Centralized Error Handling

All error responses follow a uniform JSON structure:

```json
{
  "success": false,
  "error": {
    "code": "<ERROR_CODE>",
    "message": "<Human-readable message>"
  }
}
```

| Error Code | HTTP Status | Description |
|---|---|---|
| `PORTAL_AUTH_FAILED` | 401 / 501 | Authentication credential check failed or missing credentials |
| `PORTAL_SESSION_EXPIRED` | 401 / 403 | Active session cookie has expired, invalid, or unauthorized |
| `PORTAL_TIMEOUT` | 504 | Urja Meter Ops portal exceeded request timeout threshold |
| `PORTAL_UNAVAILABLE` | 503 | Urja Meter Ops portal returned 502/503/504 or connection refused |
| `INVALID_CONFIGURATION` | 500 | Environment variables failed Zod schema validation |
| `ROUTE_NOT_FOUND` | 404 | Requested URL path does not exist on this API |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected internal application error |

---

## 10. Automated Testing

All tests run completely offline with mocked portal interactions to guarantee deterministic execution.

```bash
cd urja-meter-api
npm test
```

### Test Suite Summary:
- **`tests/health.test.ts`**: Verifies `/api/v1/health` and global 404 error routing.
- **`tests/portal-client.test.ts`**: Verifies Zod environment validation, fail-fast mechanisms, sensitive credential log redaction, cookie jar persistence across requests, cookie clearing, and Axios error normalization.
- **`tests/auth.test.ts`**: Verifies session token initialization, session validation against mocked 200 OK responses, cache TTL hit verification, session expiration detection (401/403 responses), network timeout (504), network outage (503), and isolated direct login contract.

---

## 11. Current Implementation Status & Known Limitations

### Completed in Phase 1
- Full TypeScript + Express foundation.
- Zod environment configuration validation.
- Reusable `PortalClient` with `tough-cookie` persistence.
- Layered `AuthService` supporting Better Auth session lifecycle.
- Express API endpoints (`/api/v1/health` and `/api/v1/portal/status`).
- Centralized error middleware with sensitive data masking.
- 27/27 automated unit and integration tests passing.

### Known Limitations (By Design for Phase 1)
- **Direct Login Payload**: As instructed in Phase 1 guidelines, the internal username/password login endpoint schema is isolated behind `IAuthService.login()` and has not been guessed or reverse-engineered. Authentication currently operates via session token (`PORTAL_SESSION_TOKEN`).
- **Signature Algorithm**: Export endpoints requiring `X-Signature` and `X-Timestamp` are slated for subsequent phases and have not been implemented or guessed.
- **Portal Data Endpoints**: Meter search, geography, energy consumption, DT listings, and bulk exports are not exposed in Phase 1.

---

## 12. Recommended Phase 2 Tasks

1. **Meter Search & Listing API**: Implement `GET /api/v1/meters` with pagination query parameters (`q`, `page`) mapped directly to `/portal/meters/search`.
2. **Meter Geography & Energy APIs**: Implement `GET /api/v1/meters/:meterId/geo` and `GET /api/v1/meters/:meterId/energy`.
3. **Transformer (DT) Listing API**: Implement `GET /api/v1/transformers` calling `/portal/dts?page=:page`.
4. **Credential Login Contract**: Ingest verified credentials login payload specification and connect it to `AuthService.login()`.
5. **Signing Client Integration**: Implement signing keys fetcher (`/portal/keys`) and signature computation for bulk export (`/portal/export`).
