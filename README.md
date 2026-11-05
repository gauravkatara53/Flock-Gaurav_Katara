# Urja Meter Ops API Service

A clean, maintainable, production-ready backend service built on Node.js, Express, and TypeScript over the Urja Meter Ops portal (`https://urja-ops.flockenergy.tech`).

---

## 1. Project Overview

The **Urja Meter Ops API Service** serves as a structured REST API layer over the Urja Meter Ops SvelteKit application. It bridges the gap between external consumers and internal portal services, abstracting session lifecycle management, request signing, rate limiting, data normalization, local caching, concurrency management, and network hierarchy modeling.

### Phase 1 Scope

- **Backend Foundation**: Production TypeScript project with Zod configuration validation, structured logging with secret redaction, and centralized error handling.
- **Resilient Portal Client**: Reusable HTTP client leveraging Axios and `tough-cookie` for automated cookie jar management across requests.
- **Authentication Service**: Robust Better Auth session cookie (`__Secure-better-auth.session_token`) management, session validation, active caching, and decoupled login interfaces.
- **Core APIs**: `/api/v1/health` and `/api/v1/portal/status`.
- **Mocked Automated Test Suite**: Full test coverage across environment validation, client initialization, cookie persistence, session verification, and network error handling without making unauthorized live portal calls.

### Phase 2 Scope

- **Meter Search API**: `GET /api/v1/meters` — search meters with pagination, query filtering, and normalized response shapes.
- **Meter Location API**: `GET /api/v1/meters/:meterId/location` — fetch GPS coordinates for individual meters.
- **Meter Consumption API**: `GET /api/v1/meters/:meterId/consumption` — fetch and normalize energy/consumption readings with original timestamps preserved.
- **Transformer List API**: `GET /api/v1/transformers` — paginated list of distribution transformers (DTs).
- **Zod Request Validation**: All inputs validated with Zod schemas (`page`, `q`, `meterId`).
- **Normalized Responses**: Consistent API response shapes with `success`, `data`, and `pagination` fields; raw portal data preserved for transparency.
- **Comprehensive Error Handling**: Timeouts, auth failures, invalid inputs, empty results, and unexpected portal responses all handled gracefully.

### Phase 3 Scope (Bulk Export & Local Data Index)

- **Bulk Export Integration**: Integrates `GET /portal/export?page=1` with multi-page discovery and normalization.
- **Request Signing Architecture**: Pluggable `IRequestSigner` interface. In adherence to strict security guidelines, the signing algorithm is never guessed without verified evidence, leaving headers optional by default while allowing verified HMAC/token signers.
- **Data Normalization**: Bulk meter details, hierarchy, and coordinates extracted into structured records while keeping raw payloads.
- **Lightweight Local Index**: Zero-dependency in-memory index (`LocalMeterIndex`) with fast multi-field search and direct lookup by meter ID or meter number.
- **Failure Isolation**: Staged commit mechanism guarantees that failed export attempts never destroy previously indexed valid data.
- **Export & Local Search APIs**: `/api/v1/meters/export`, `/api/v1/meters/export/status`, `/api/v1/meters/local`, `/api/v1/meters/local/:meterId`.

### Phase 4 Scope (Network Hierarchy Implementation)

- **8-Tier Normalized Network Hierarchy**:
  `Zone → Circle → Division → Subdivision → Substation → Feeder → Transformer → Meter`
- **Zero Duplicate Storage**: Directly reuses the existing `LocalMeterIndex` in-memory records to generate statistical summaries, trees, navigation nodes, and filtered results without duplicating storage.
- **Hierarchy Overview**: `GET /api/v1/hierarchy` — returns statistical counts across all 8 tiers.
- **Hierarchy Tree**: `GET /api/v1/hierarchy/tree` — returns multi-tier hierarchical tree with configurable depth.
- **Child Navigation**: `GET /api/v1/hierarchy/children` — navigates child entities at a specific level constrained by parent scopes.
- **Multi-Level Meter Filtering**: `GET /api/v1/hierarchy/meters` (and `GET /api/v1/meters/local`).
- **Transformer Meter Association**: `GET /api/v1/transformers/:transformerId/meters` and `GET /api/v1/hierarchy/transformers/:transformerId/meters`.

### Phase 5 Scope (Caching, Concurrency, and Optimization)

- **Lightweight In-Memory Cache (`CacheService`)**: High-performance in-memory caching with configurable TTL, tag-based invalidation, LRU eviction, and operational metrics (hit ratio, hits, misses).
- **Proper Cache Invalidation**: Automatic invalidation of all cached queries (`meters`, `transformers`, `hierarchy`, `local`) upon successful bulk export completion.
- **Duplicate Simultaneous Export Prevention**: Concurrency lock deduplicates overlapping bulk export requests into a single in-flight operation.
- **Optimized Inverted Indexing**: Pre-computed lowercase search tokens and inverted tier buckets (`idsByZone`, `idsByFeeder`, `idsByTransformer`, etc.) transform linear scans into O(1) candidate lookups.
- **Request Timeout Middleware**: Protects client requests with configurable `REQUEST_TIMEOUT_MS` (default 15s) producing consistent 504 `PORTAL_TIMEOUT` responses.
- **Structured Duration & Status Logging**: Logs HTTP response execution times and status codes with sensitive data completely masked.
- **120 Automated Offline Tests**: Includes dedicated cache, concurrency, and performance benchmark suites.

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

```
┌────────────────────────────────────────────────────────┐
│                   Incoming HTTP Client                 │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Express Middleware                   │
│   (Request Timeout, Structured Timing Logging, 404)    │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Express Router                       │
│    /api/v1/health                                      │
│    /api/v1/portal/status                               │
│    /api/v1/meters         (Phase 2)                    │
│    /api/v1/meters/export  (Phase 3 & 5)                │
│    /api/v1/meters/local   (Phase 3, 4, 5)              │
│    /api/v1/transformers   (Phase 2 & 4)                │
│    /api/v1/hierarchy      (Phase 4 & 5)                │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                  Controller Layer                      │
│     (MeterController, TransformerController,           │
│      ExportController, HierarchyController)            │
│     Zod input validation & response formatting         │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Service Layer                        │
│   (AuthService, MeterService, TransformerService,      │
│    BulkExportService, LocalMeterIndex,                 │
│    HierarchyService, CacheService)                     │
│   Optimized inverted index & Tagged In-Memory Cache    │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                Portal HTTP Client                      │
│     (Axios + tough-cookie jar + Error Normalizer       │
│      + Pluggable Request Signer)                       │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│          Urja Meter Ops Portal (SvelteKit)             │
│        https://urja-ops.flockenergy.tech               │
└────────────────────────────────────────────────────────┘
```

---

## 4. Directory Structure

```text
urja-meter-api/
├── src/
│   ├── config/
│   │   └── env.ts                    # Zod environment schema & fail-fast validation
│   ├── clients/
│   │   └── portal.client.ts          # Axios + tough-cookie reusable client
│   ├── controllers/
│   │   ├── meter.controller.ts       # Meter endpoints validation & formatting
│   │   ├── transformer.controller.ts # Transformer endpoints validation & formatting
│   │   ├── export.controller.ts      # Export & local index endpoints
│   │   └── hierarchy.controller.ts   # Network hierarchy endpoints
│   ├── services/
│   │   ├── auth.service.ts           # Better Auth session & lifecycle management
│   │   ├── cache.service.ts          # Phase 5 in-memory caching with TTL & tags
│   │   ├── meter.service.ts          # Meter search, location, consumption
│   │   ├── transformer.service.ts    # Transformer listing
│   │   ├── request-signer.service.ts # Request signing interface & adapters
│   │   ├── local-index.service.ts    # Optimized inverted index
│   │   ├── bulk-export.service.ts    # Export coordinator & concurrency lock
│   │   └── hierarchy.service.ts      # Network hierarchy service
│   ├── middleware/
│   │   ├── error.middleware.ts       # Centralized error & 404 middleware
│   │   └── timeout.middleware.ts     # Phase 5 request timeout middleware
│   ├── routes/
│   │   ├── health.routes.ts          # GET /api/v1/health
│   │   ├── portal.routes.ts          # GET /api/v1/portal/status
│   │   ├── meter.routes.ts           # GET /api/v1/meters/*
│   │   ├── transformer.routes.ts     # GET /api/v1/transformers/*
│   │   └── hierarchy.routes.ts       # GET /api/v1/hierarchy/*
│   ├── utils/
│   │   └── logger.ts                 # Structured logging with secret redaction
│   ├── types/
│   │   ├── portal.types.ts           # Portal schemas, types, and AppError class
│   │   ├── meter.types.ts            # Meter/Transformer Zod schemas & normalized types
│   │   ├── export.types.ts           # Export & local index types
│   │   └── hierarchy.types.ts        # Hierarchy schemas & models
│   ├── app.ts                        # Express application factory
│   └── server.ts                     # Server entrypoint and graceful shutdown
├── tests/
│   ├── health.test.ts                # Health route & 404 test suite
│   ├── auth.test.ts                  # Authentication & status integration tests
│   ├── portal-client.test.ts         # Client initialization, cookies & normalization
│   ├── meters.test.ts                # Meter & Transformer API test suite
│   ├── bulk-export.test.ts           # Bulk Export & Local Index test suite
│   ├── hierarchy.test.ts             # Network Hierarchy test suite
│   └── cache.test.ts                 # Phase 5 Cache, Concurrency & Benchmark suite
├── .env.example                      # Template environment variables
├── .gitignore                        # Git ignore file
├── package.json                      # Dependencies & scripts
├── tsconfig.json                     # TypeScript compiler configuration
├── vitest.config.ts                  # Vitest test configuration
└── README.md                         # Documentation
```

---

## 5. Configuration & Environment Variables

| Variable               | Type   | Default                             | Description                                            |
| ---------------------- | ------ | ----------------------------------- | ------------------------------------------------------ |
| `PORT`                 | number | `3000`                              | Port for Express server                                |
| `NODE_ENV`             | string | `development`                       | Environment mode (`development`, `production`, `test`) |
| `PORTAL_BASE_URL`      | string | `https://urja-ops.flockenergy.tech` | Urja Ops Portal base URL                               |
| `PORTAL_USERNAME`      | string | `""`                                | Portal username (redacted in logs)                     |
| `PORTAL_PASSWORD`      | string | `""`                                | Portal password (redacted in logs)                     |
| `PORTAL_TIMEOUT_MS`    | number | `10000`                             | Upstream portal client timeout (ms)                    |
| `PORTAL_SESSION_TOKEN` | string | `""`                                | Better Auth session token cookie                       |
| `CACHE_TTL_MS`         | number | `60000`                             | In-memory cache time-to-live (ms)                      |
| `CACHE_MAX_ENTRIES`    | number | `1000`                              | Maximum entries retained in cache before LRU eviction  |
| `REQUEST_TIMEOUT_MS`   | number | `15000`                             | API request timeout threshold before 504 error (ms)    |

---

## 6. Development & Build Commands

| Command                 | Action                                                     |
| ----------------------- | ---------------------------------------------------------- |
| `npm run dev`           | Starts server in watch mode using `tsx`                    |
| `npm run build`         | Compiles TypeScript into `./dist`                          |
| `npm start`             | Runs production server from `./dist/server.js`             |
| `npm test`              | Runs all 120 Vitest unit, integration, and benchmark tests |
| `npm run test:coverage` | Runs tests and outputs coverage table                      |

---

## 7. Performance Benchmarks & Measurements (Phase 5)

Tested against a representative mocked dataset of **5,000 meter records** across 4 zones, 10 circles, 25 divisions, 50 feeders, and 100 transformers:

| Operation                                           | Cold Execution (Uncached) | Warm Execution (Cached) | Improvement Factor  |
| --------------------------------------------------- | ------------------------- | ----------------------- | ------------------- |
| **Multi-Tier Meter Filter** (`zone` + `feeder`)     | **0.419 ms**              | **0.005 ms**            | **~83x speedup**    |
| **Hierarchy Tree Generation** (`depth=subdivision`) | **11.875 ms**             | **0.003 ms**            | **~3,950x speedup** |
| **Meter Search Query**                              | **0.380 ms**              | **0.004 ms**            | **~95x speedup**    |

_Measured via `tests/cache.test.ts` using Node.js `perf_hooks.performance.now()`._

---

## 8. Complete API Reference

### Health & Portal

- `GET /api/v1/health` — Service health
- `GET /api/v1/portal/status` — Portal session status

### Live Portal APIs

- `GET /api/v1/meters?q=&page=` — Search meters
- `GET /api/v1/meters/:meterId/location` — Meter coordinates
- `GET /api/v1/meters/:meterId/consumption` — Meter energy readings
- `GET /api/v1/transformers?page=` — List transformers

### Bulk Export & Local Index

- `GET /api/v1/meters/export` — Trigger bulk data import (concurrent requests deduplicated)
- `GET /api/v1/meters/export/status` — Export status and last refresh timestamp
- `GET /api/v1/meters/local?q=&zone=&feeder=&page=&limit=` — Fast indexed local search
- `GET /api/v1/meters/local/:meterId` — Get local meter by ID or meter number

### Network Hierarchy

- `GET /api/v1/hierarchy` — 8-tier statistical counts
- `GET /api/v1/hierarchy/tree?depth=` — Multi-tier hierarchy tree
- `GET /api/v1/hierarchy/children?level=&zone=...` — Child navigation
- `GET /api/v1/hierarchy/meters?zone=&feeder=&page=` — Filtered meters
- `GET /api/v1/transformers/:transformerId/meters` — Meters under transformer

---

## 9. Error Codes & Handling

| Error Code               | HTTP Status | Description                                    |
| ------------------------ | ----------- | ---------------------------------------------- |
| `VALIDATION_ERROR`       | 400         | Query/path parameter failed Zod schema check   |
| `NOT_FOUND`              | 404         | Meter or resource not found in local index     |
| `ROUTE_NOT_FOUND`        | 404         | Requested URL path does not exist              |
| `PORTAL_AUTH_FAILED`     | 401 / 501   | Portal credentials missing or rejected         |
| `PORTAL_SESSION_EXPIRED` | 401 / 403   | Better Auth session expired or invalid         |
| `PORTAL_TIMEOUT`         | 504         | Upstream portal or request timeout exceeded    |
| `PORTAL_UNAVAILABLE`     | 503         | Upstream portal 502/503/504 or network outage  |
| `INVALID_CONFIGURATION`  | 500         | Environment variables failed schema validation |
| `INTERNAL_SERVER_ERROR`  | 500         | Unexpected application error                   |

---

## 10. Automated Testing

All 120 tests run offline using mocked data:

```bash
cd urja-meter-api
npm test
```

### Test Suite Breakdown:

- **`tests/health.test.ts`** (2 tests): Health check & 404 routing.
- **`tests/portal-client.test.ts`** (12 tests): Zod validation, credential redaction, cookie jar, error normalization.
- **`tests/auth.test.ts`** (13 tests): Session lifecycle, token storage, cache TTL, session expiry detection.
- **`tests/meters.test.ts`** (32 tests): Live meter search, location coordinates, consumption readings, transformer listing.
- **`tests/bulk-export.test.ts`** (22 tests): Bulk import trigger, status reporting, local search, single-meter retrieval, failure isolation, deduplication, request signing.
- **`tests/hierarchy.test.ts`** (28 tests): Summary statistics, navigation, tree generation, multi-tier filtering, transformer meters.
- **`tests/cache.test.ts`** (11 tests):
  - Cache set, get, hit/miss statistics, and TTL expiration
  - Tag-based invalidation and LRU eviction order
  - Endpoint caching for meters, transformers, and hierarchy queries
  - Automatic cache invalidation on bulk export import
  - Simultaneous duplicate bulk export deduplication
  - Performance benchmark measurements on 5,000 meter dataset

---

## 11. Remaining Limitations & Boundaries

1. **Direct Credentials Login Schema**: Better Auth username/password login endpoint remains isolated behind `ILoginAdapter` until verified; authentication operates via `PORTAL_SESSION_TOKEN`.
2. **Export Signing Algorithm**: Request signing algorithm is intentionally unverified and un-guessed per project instructions. Verified algorithms can be attached via `IRequestSigner`.
3. **No Heavy Infrastructure**: In adherence to strict project rules, no Redis, Kafka, MongoDB, or external databases are used. Local indexing and caching are stored safely in-memory with atomic commits.
4. **Data Persistence**: Because storage is in-memory, the local index and cache reset upon server process restart. A call to `GET /api/v1/meters/export` re-populates the cache.

---

## 12. Engineering Assumptions & Design Decisions

### Key Assumptions

1. **Upstream Portal Stability**: Assumed that the upstream portal endpoints (`/portal/api/meters`, `/portal/api/transformers`, `/portal/export`) follow predictable query and pagination parameters.
2. **Session Lifespan**: Better Auth session tokens are assumed to be valid for standard operational windows, but may expire at any moment; our client detects 401/403 responses dynamically and invalidates cached session states.
3. **Volatile Local In-Memory Storage**: Per the explicit project restrictions ("no Redis, Kafka, MongoDB"), all data indexing and caching operate strictly in-memory. In-memory data structures are tuned for rapid reads and low memory footprints.
4. **Data Integrity Over Guesswork**: Where documentation or endpoint contracts were unverified (such as direct credential login payloads and HMAC signing keys), strict programmatic boundary interfaces (`ILoginAdapter`, `IRequestSigner`) were created rather than guessing algorithms or fabricating dummy payloads.

### Design Decisions

1. **Three-Tier Inverted Index for Meters**:
   - Rather than scanning arrays with `.filter()` on every request, `LocalMeterIndex` maintains:
     - `Map<string, LocalMeterRecord>` for $O(1)$ ID and meter-number lookups.
     - Inverted secondary index `Map<string, Set<string>>` for each tier: Zone, Circle, Division, Subdivision, Substation, Feeder, and Transformer.
     - Pre-tokenized search text strings for fast substring matching.
   - Set intersection reduces query evaluation times from linear $O(N)$ scans down to sub-millisecond lookups ($0.38$ ms on 5,000 meters).
2. **Cache-Aside with Atomic Invalidation**:
   - `CacheService` is tag-aware (`meters`, `transformers`, `hierarchy`, `export`).
   - When a bulk import completes, `bulkExportService` executes atomic tag invalidation (`invalidateTag('meters')`, `invalidateTag('hierarchy')`), guaranteeing that clients never receive stale cached data after an update.
3. **Flight De-duplication for Bulk Operations**:
   - Long-running export calls to `/portal/export` can overwhelm the network if multiple users trigger them concurrently. An internal `inFlightExportPromise` lock collapses parallel calls into a single running Promise.
4. **Pre-Cache Authentication Enforcement**:
   - In `MeterService` and `TransformerService`, authentication verification (`authService.ensureAuthenticated()`) is always executed **before** checking the response cache. This guarantees unauthorized requests are rejected with 401/501 instead of leaking cached data.

---

## 13. Trade-Offs & Skipped Work

| Decision / Trade-off                      | Rationale                                                                                                         | Alternatives Considered                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **In-memory store vs. SQLite/PostgreSQL** | Strict adherence to "no database / no external infrastructure" rule. Kept codebase zero-dependency for storage.   | SQLite/LevelDB would persist across restarts, but was restricted by project requirements. |
| **Monolithic server vs. Microservices**   | Urja Ops API is a cohesive gateway proxy. Single-process architecture minimized latency and complexity.           | Worker threads or external job queues (Kafka/BullMQ).                                     |
| **Skipped speculative signing**           | Cryptographic signing without official keys or canonical header formats produces rejected upstream requests.      | Inventing a mock SHA-256 algorithm was rejected to preserve protocol integrity.           |
| **Skipped speculative credential login**  | Better Auth endpoints involve CSRF tokens and cookies. Attempting unverified POST bodies could lock out accounts. | Trial-and-error POST to `/api/auth/sign-in` was rejected per strict safety rules.         |

---

## 14. Future Improvements

1. **Persistent Backing Store**: When project constraints permit, integrate SQLite, Redis, or PostgreSQL via a repository interface so indexed data survives process restarts.
2. **Webhooks / Streaming Ingestion**: Replace manual `/meters/export` polling with Server-Sent Events (SSE) or Webhook listeners if the upstream portal adds notification support.
3. **Role-Based Access Control (RBAC)**: Introduce client-level JWT or API key middleware to partition administrative actions (triggering bulk export) from read-only meter queries.
4. **Differential Sync**: Support incremental delta updates (`since={timestamp}`) for bulk export to minimize upstream bandwidth consumption.

---

## 15. Reflection: Challenges, Solutions & Lessons Learned

### Key Challenges

1. **Balancing Caching with Security**:
   - _Challenge_: Storing query responses in cache could inadvertently allow unauthorized requests to retrieve data if the cache check occurred before session validation.
   - _Solution_: Re-architected service flows to strictly authenticate requests prior to querying `CacheService`.
2. **LRU Eviction Under Sub-Millisecond Bursts**:
   - _Challenge_: Node.js `Date.now()` resolution can produce identical timestamps for multiple cache insertions in the same event-loop tick, causing non-deterministic LRU eviction.
   - _Solution_: Introduced a monotonic incrementing counter (`accessOrder`) alongside millisecond timestamps, ensuring 100% deterministic LRU ordering.
3. **High-Performance Multi-Tier Hierarchy Queries**:
   - _Challenge_: Constructing deeply nested 8-tier hierarchy trees across thousands of records repeatedly incurred high CPU overhead.
   - _Solution_: Implemented level-depth cutoffs and tag-based caching, cutting tree generation from ~12 ms to 0.003 ms (~3,950x speedup).

### Lessons Learned

- **Respect Protocol Boundaries**: Isolating unverified components behind well-defined interfaces (`ILoginAdapter`, `IRequestSigner`) keeps the codebase resilient, extensible, and clean without violating protocol integrity.
- **Measurable Optimization**: Benchmarking with Node.js `performance.now()` provided verifiable evidence of optimization gains rather than ungrounded claims.
