# Urja Ops Portal Protocol Specification

This document provides a comprehensive technical specification of the upstream Urja Ops Portal communication protocol, session management lifecycle, data exchange envelopes, error mapping, pagination semantics, request signing architecture, and protocol-level boundaries.

---

## 1. Upstream Architecture & Communication Overview

The Urja Ops Portal (`https://urja-ops.flockenergy.tech`) is a modern energy utility management platform built on **SvelteKit** and **Better Auth**.

### Network Topology

```
+------------------------------------+
| Client / API Consumers             |
+-----------------+------------------+
                  |
                  | HTTP/REST (Port 3000)
                  v
+-----------------+------------------+
| urja-meter-api Service             |
| - PortalClient (Axios / CookieJar) |
| - AuthService (Session Manager)    |
| - LocalMeterIndex (In-Memory)      |
| - CacheService (LRU In-Memory)     |
+-----------------+------------------+
                  |
                  | HTTPS (Strict Redaction & Headers)
                  v
+-----------------+------------------+
| Upstream Urja Ops Portal Server   |
| (https://urja-ops.flockenergy.tech)|
+------------------------------------+
```

### Transport & Headers

- **Transport Security**: TLS 1.3 over HTTPS.
- **Default Timeout**: Configurable via `PORTAL_TIMEOUT_MS` (default: 10,000 ms).
- **Standard Request Headers**:
  - `User-Agent`: `urja-meter-api/1.0.0`
  - `Accept`: `application/json, text/plain, */*`
  - `Accept-Encoding`: `gzip, deflate, br`
  - `Cookie`: Automatic stateful session cookies managed via `tough-cookie`.

---

## 2. Upstream Portal Endpoints

The API interacts with the following upstream routes discovered on the Urja Ops Portal:

| Upstream Endpoint                          | Method | Description                      | Upstream Data Structure                                                 |
| ------------------------------------------ | ------ | -------------------------------- | ----------------------------------------------------------------------- |
| `/portal` or `/`                           | `GET`  | Health / landing check           | HTML or HTTP 200/302 status                                             |
| `/api/auth/get-session`                    | `GET`  | Better Auth session verification | Returns `{ user: { id, email, ... }, session: { id, expiresAt, ... } }` |
| `/portal/api/meters?q={query}&page={page}` | `GET`  | Search and list meters           | Returns `{ meters: [...], total, page, totalPages }`                    |
| `/portal/api/meters/{meterId}/location`    | `GET`  | Meter geographic coordinates     | Returns `{ meterId, latitude, longitude, address? }`                    |
| `/portal/api/meters/{meterId}/consumption` | `GET`  | Meter interval energy readings   | Returns `{ meterId, readings: [{ timestamp, kwh, kw? }] }`              |
| `/portal/api/transformers?page={page}`     | `GET`  | Transformer infrastructure list  | Returns `{ transformers: [...], total, page, totalPages }`              |
| `/portal/export?page={page}`               | `GET`  | Bulk export batch data           | Returns raw batch array or envelope `{ records: [...] }`                |

---

## 3. Session Management & Authentication Lifecycle

### Better Auth Mechanism

The upstream portal uses Better Auth for session authentication. Authentication state is tracked using an HTTP cookie named:

```http
Cookie: __Secure-better-auth.session_token=<session_token>
```

### Session Verification Strategy

1. **Verification Endpoint**: When verifying authentication status, the API sends a `GET` request to:
   ```http
   GET /api/auth/get-session HTTP/1.1
   Host: urja-ops.flockenergy.tech
   Cookie: __Secure-better-auth.session_token=<token>
   ```
2. **Session Cache (30s TTL)**:
   - To avoid slamming the upstream portal with session verification requests on every incoming client call, `AuthService` maintains an internal 30-second TTL cache on verification results.
   - Cache bypass is supported via the query parameter `?force=true` on `GET /api/v1/portal/status`.
3. **Cookie Jar Integration**:
   - `PortalClient` uses an `axios-cookiejar-support` wrapped instance backed by `tough-cookie`.
   - When `PORTAL_SESSION_TOKEN` is supplied via environment variables, it is synchronized into the cookie jar before upstream requests.

### Decoupled Login Architecture (`ILoginAdapter`)

Direct username/password authentication against the portal's login endpoints is isolated behind the `ILoginAdapter` interface:

- **Status**: The exact JSON payload, CSRF requirements, and endpoint for username/password login remain unverified in the upstream portal.
- **Design Rule**: In compliance with strict engineering instructions, the API does not attempt speculative login attempts. The `DefaultLoginAdapter` throws a standard `PortalAuthError` explaining that `PORTAL_SESSION_TOKEN` must be configured.
- When the login protocol is formally verified, an adapter conforming to `ILoginAdapter` can be plugged in without modifying any service or controller logic.

---

## 4. Request Signing Architecture

The portal export route `/portal/export` is specified to support request signing headers:

```http
X-Signature: <computed_signature>
X-Timestamp: <iso_or_epoch_timestamp>
```

### Protocol Boundary & Safety

- **Strict Verification Policy**: No signature algorithms are guessed or fabricated.
- **Implementation**: The `RequestSignerService` implements the `IRequestSigner` interface.
- If a signature algorithm is unverified, `signExportRequest()` returns an empty header object (`{}`), allowing normal authenticated requests using the session cookie.
- If verified credentials/algorithm become available, they are encapsulated in `IRequestSigner.sign(...)`.

---

## 5. API Response Formats & Standards

All responses from `urja-meter-api` adhere to a strictly typed, predictable JSON envelope.

### 5.1 Success Envelope

```json
{
  "success": true,
  "data": { ... },
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1250,
    "totalPages": 25
  },
  "cached": false
}
```

### 5.2 Error Envelope

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid query parameters",
    "details": [
      {
        "field": "page",
        "message": "Expected number, received string"
      }
    ]
  }
}
```

### 5.3 Error Code Mapping

| Upstream / Internal State              | API Error Code           | HTTP Status                 |
| -------------------------------------- | ------------------------ | --------------------------- |
| Query or path validation failure       | `VALIDATION_ERROR`       | `400 Bad Request`           |
| Resource not found in index            | `NOT_FOUND`              | `404 Not Found`             |
| Invalid route or method                | `ROUTE_NOT_FOUND`        | `404 Not Found`             |
| Upstream returns 401 Unauthorized      | `PORTAL_AUTH_FAILED`     | `401 Unauthorized`          |
| Upstream returns 403 Forbidden         | `PORTAL_SESSION_EXPIRED` | `403 Forbidden`             |
| Upstream timeout or connection dropped | `PORTAL_TIMEOUT`         | `504 Gateway Timeout`       |
| Upstream 500, 502, 503 error           | `PORTAL_UNAVAILABLE`     | `503 Service Unavailable`   |
| Invalid environment configuration      | `INVALID_CONFIGURATION`  | `500 Internal Server Error` |
| Unhandled runtime exceptions           | `INTERNAL_SERVER_ERROR`  | `500 Internal Server Error` |

---

## 6. Pagination Semantics

Pagination parameters are unified across all search and listing endpoints:

| Parameter | Type    | Default | Constraints  | Description                                    |
| --------- | ------- | ------- | ------------ | ---------------------------------------------- |
| `page`    | Integer | `1`     | `>= 1`       | 1-based page number                            |
| `limit`   | Integer | `50`    | `1` to `200` | Number of items per page (local index queries) |

### Pagination Metadata Object

```typescript
interface PaginationMeta {
  page: number; // Current page number (1-indexed)
  limit: number; // Items per page
  total: number; // Total records matching the criteria
  totalPages: number; // Math.ceil(total / limit)
}
```

---

## 7. Data Normalization & Transformation

Data returned by the upstream portal may contain heterogeneous keys, null values, or alternative naming. The service normalizes records into consistent domain types:

### 7.1 Meter Normalization

Upstream keys like `meter_number`, `meterId`, `serial_no` are normalized to:

```typescript
interface MeterSummary {
  id: string;
  meterNumber: string;
  consumerName: string;
  consumerNumber: string;
  status: "ACTIVE" | "INACTIVE" | "DISCONNECTED" | "UNKNOWN";
  transformerId?: string;
  feederId?: string;
  substationId?: string;
  address?: string;
}
```

### 7.2 Consumption Data Normalization

Raw interval readings are sanitized:

- Original timestamps are preserved strictly (ISO 8601 strings).
- Missing consumption values are **never fabricated** or interpolated.
- Readings without valid energy values are flagged or omitted from aggregate calculations.

### 7.3 Network Hierarchy Normalization

The hierarchy levels strictly follow utility distribution standards:

```
Zone (Tier 1)
  └── Circle (Tier 2)
        └── Division (Tier 3)
              └── Subdivision (Tier 4)
                    └── Substation (Tier 5)
                          └── Feeder (Tier 6)
                                └── Transformer (Tier 7)
                                      └── Meter (Tier 8)
```

- Missing hierarchy fields are preserved as `'UNKNOWN'` or safely omitted without breaking the tree traversal.

---

## 8. Security & Data Protection Controls

1. **Credential & Cookie Redaction**:
   - The logger (`src/utils/logger.ts`) and error sanitizer (`src/middleware/error.middleware.ts`) automatically scan and redact:
     - `PORTAL_PASSWORD`
     - `PORTAL_SESSION_TOKEN`
     - `Cookie` / `Set-Cookie` headers
     - `Authorization` headers
     - Any key matching `/(password|token|secret|cookie|auth|key)/i`
2. **In-Memory Volatility**:
   - The local meter index and response caches reside strictly in Node.js process memory.
   - No credentials, tokens, or customer PII are persisted to disk or external databases.
