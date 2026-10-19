# Smart Traffic Management System

A software engineering project for intelligent urban traffic monitoring and management, combining real-time traffic data, congestion detection, traffic signal optimization, emergency vehicle prioritization, route recommendations, and traffic analytics.

---

## Overview

The **Smart Traffic Management System (STM)** is designed to assist traffic authorities, emergency services, traffic police, and citizens in monitoring and responding to urban traffic conditions.

The system processes traffic-related data to support:

- Traffic monitoring and analytics
- Congestion and incident detection
- Traffic signal optimization
- Emergency vehicle prioritization
- Alternate route recommendations
- Traffic alerts and notifications
- Historical traffic analysis

The project is designed with a modular architecture so that additional AI and IoT-based components can be integrated as the system evolves.

---

## Features

### Traffic Management

- Monitor traffic conditions and measurements
- Manage traffic locations and signals
- Detect and manage congestion events
- Track traffic incidents and alerts
- Analyze historical traffic data

### Intelligent Traffic Control

- Dynamic traffic signal optimization
- Traffic-density-based signal decisions
- Emergency vehicle prioritization
- Green-corridor support for emergency vehicles

### Route Management

- Alternate route recommendations
- Route management and analysis
- Traffic-aware route decisions

### Alerts & Analytics

- Traffic alerts and notifications
- Congestion and incident alerts
- Traffic analytics
- Report generation
- Historical traffic data management

### User Roles

The system supports role-based functionality for different stakeholders.

| Role | Responsibilities |
|------|------------------|
| **Admin** | Manage system-level resources, traffic signals, analytics and reports |
| **Traffic Authority** | Monitor traffic, manage congestion and optimize signals |
| **Traffic Police** | Monitor traffic and receive alerts |
| **Emergency Service** | Request emergency priority and create green corridors |
| **Citizen** | Report incidents, receive alerts and access route recommendations |

---

## System Workflow

```text
┌─────────────────────────┐
│    Traffic Data Sources │
│ Sensors / GPS / CCTV    │
│ Citizen Reports         │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│    Traffic Monitoring   │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Traffic Data Analysis │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Congestion / Incident   │
│       Detection         │
└──────┬─────────┬────────┘
       │         │
       │         └─────────────────┐
       ▼                           ▼
┌───────────────┐          ┌──────────────────┐
│ Signal        │          │ Emergency        │
│ Optimization  │          │ Prioritization   │
└───────┬───────┘          └────────┬─────────┘
        │                           │
        ▼                           ▼
 Traffic Signals             Green Corridor
        │
        └──────────────┬───────────────┐
                       │               │
                       ▼               ▼
              Route Recommendation   Alerts
                       │
                       ▼
                 Dashboards &
                   Analytics
```

---

## Architecture

The project follows a modular application architecture:

```text
STM
│
├── frontend/
│   └── Web-based user interface
│
├── backend/
│   ├── Controllers
│   ├── Routes
│   ├── Models
│   ├── Services
│   ├── Middleware
│   └── Database Configuration
│
├── ai-service/
│   └── Offline recorded-video vehicle detection and tracking MVP
│
└── simulator/
    └── Traffic simulation components
```

> **Note:** `ai-service` currently provides an isolated offline vehicle-detection and optional tracking MVP for recorded videos. It is not integrated with backend measurements or live CCTV. A development-only backend traffic simulator is documented below.

---

## Technology Stack

### Frontend

- React
- Vite
- JavaScript
- HTML5
- CSS3

### Backend

- Node.js
- Express.js
- JavaScript
- REST APIs

### Database

- MySQL

### Development Tools

- Git
- GitHub
- Visual Studio Code
- npm

---

## Backend Modules

The backend is organized into separate controllers, routes, models, and services.

### Controllers

The system currently contains controllers for:

- Authentication
- Congestion Events
- Emergency Priority
- Emergency Vehicles
- Monitoring Devices
- Routes
- Route Recommendations
- Signal Optimization
- Traffic Alerts
- Traffic Analytics
- Traffic Locations
- Traffic Measurements
- Traffic Signals

### Services

Core business logic is separated into services for:

- Congestion detection
- Emergency priority
- Route recommendation
- Signal optimization
- Traffic alerts
- Traffic analytics

This separation allows the application to remain modular and easier to maintain as additional functionality is introduced.

---

## Project Structure

```text
STM/
│
├── backend/
│   ├── config/
│   ├── controllers/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── services/
│   ├── package.json
│   └── server.js
│
├── frontend/
│   ├── public/
│   ├── src/
│   ├── package.json
│   └── vite.config.js
│
├── ai-service/
│
├── simulator/
│
├── .gitignore
└── README.md
```

---

## Getting Started

### Prerequisites

Make sure the following are installed:

- Node.js
- npm
- MySQL
- Git

### Clone the Repository

```bash
git clone https://github.com/twhdd/STM.git
cd STM
```

### Backend Setup

```bash
cd backend
npm install
```

Configure the database connection and required environment variables before starting the backend.

Then run:

```bash
npm start
```

### Development Role-Test Accounts

The backend provides an opt-in seed command for local role-based frontend testing. It only runs with `NODE_ENV=development`, requires explicit confirmation, and only connects when `STM_TEST_DATABASE_NAME` (which must contain `test`) matches the database in `MONGO_URI`. Use a dedicated test database, never a shared or production database.

When its `MONGO_URI` has no database path, the development application selects `stm_test` by default; `STM_TEST_DATABASE_NAME=stm_test` makes that target explicit. From `backend/` in PowerShell, verify/create the accounts in that same development database and enter a password at the hidden prompt:

```powershell
$env:NODE_ENV = "development"
$env:STM_TEST_DATABASE_NAME = "stm_test"
$env:STM_TEST_ACCOUNTS_CONFIRM = "YES"
$secret = Read-Host "Test account password" -AsSecureString
$env:STM_TEST_ACCOUNT_PASSWORD = [System.Net.NetworkCredential]::new("", $secret).Password
npm run seed:test-accounts
Remove-Item Env:STM_TEST_ACCOUNT_PASSWORD, Env:STM_TEST_ACCOUNTS_CONFIRM, Env:STM_TEST_DATABASE_NAME
```

`JWT_SECRET` must also be configured for login verification (the backend `.env` may provide it). The password must be at least 16 characters and include lowercase, uppercase, numeric, and symbol characters. The seed uses the existing bcrypt hashing cost, retains existing accounts and passwords, refuses role conflicts, and verifies all five accounts through the local login endpoint without displaying credentials or tokens.

### STM Test Traffic Data

To seed repeatable traffic data into the dedicated `stm_test` database, run from `backend/` in PowerShell. The script requires the explicit development, target-database, and confirmation settings below. `MONGO_URI` must point at the intended test cluster; if its URI path names a database, it must be `stm_test`. Without a database path, the script passes `stm_test` explicitly as Mongoose's `dbName`. The five existing test accounts must already exist with their intended roles; this command does not create or modify accounts.

```powershell
$env:NODE_ENV = "development"
$env:STM_TEST_DATABASE_NAME = "stm_test"
$env:STM_TEST_DATA_CONFIRM = "YES"
npm run seed:test-data
Remove-Item Env:STM_TEST_DATA_CONFIRM
```

It idempotently creates or updates the seed-owned locations, signals, monitoring devices, measurements, congestion events, routes, emergency vehicles, alerts, and two citizen reports. Repeated runs preserve operational state such as signal timing, emergency-priority activation, resolved alerts/events, and report review status. It does not delete records or drop/reset collections.

### Traffic-Processing MongoDB Integration Tests

The opt-in traffic-processing integration suite can use a dedicated test database name instead of the shared `stm_test`. The configured name must be a valid MongoDB database name containing `test` as a segment (for example, `stm_congestion_it_test`) and must not contain a `prod`, `production`, `live`, or `staging` segment. If `MONGO_URI` includes a database path, that path must exactly match `STM_TEST_DATABASE_NAME`; when it has no database path, Mongoose selects the configured name explicitly.

Before running the suite, provision a separate, empty test database on the intended non-production MongoDB cluster. Do not use the existing `stm_test` database: its historical active congestion events conflict with the lifecycle uniqueness preflight. The test runner verifies the connected database name before creating lifecycle indexes or running any test writes. It preserves the preflight and stops without changing records if conflicting active events or alerts already exist. The suite does not seed data or migrate existing records; its own fixtures use unique identifiers and are cleaned up by the tests.

Provision/verify the dedicated database on a non-production cluster first. From `backend/` in PowerShell, set `MONGO_URI` to that cluster (for example, for a local MongoDB instance use `mongodb://127.0.0.1:27017/stm_congestion_it_test`; for a remote cluster use its dedicated test URI with the matching database path, or no path). Ensure `JWT_SECRET` is configured, then run:

```powershell
$env:MONGO_URI = "mongodb://127.0.0.1:27017/stm_congestion_it_test"
$env:NODE_ENV = "development"
$env:STM_TEST_DATABASE_NAME = "stm_congestion_it_test"
$env:STM_TEST_DATA_CONFIRM = "YES"
$env:STM_RUN_TRAFFIC_PROCESSING_INTEGRATION = "YES"
node --test tests/trafficMeasurementProcessing.integration.test.js
Remove-Item Env:STM_RUN_TRAFFIC_PROCESSING_INTEGRATION, Env:STM_TEST_DATA_CONFIRM
```

The integration opt-in and confirmation are both required. The worker processes used by the cross-process concurrency test inherit the same guarded environment, validate it independently, connect to that same configured database, and verify the connected database name before processing.

### Development Traffic Simulator

The backend includes an opt-in traffic simulator for development. It generates clearly labeled simulated measurements using the same ingestion, congestion-detection, and alert-processing pipeline as submitted measurements. Simulator measurements have `source: "SIMULATOR"`; measurements submitted through the existing API default to `source: "API"` (this source label does not assert that data is verified live traffic). The simulator uses existing active traffic locations and `TRAFFIC_SENSOR` devices; it does not create locations/devices or modify existing measurements. New simulated measurements are retained when the process stops.

The simulator is disabled by default. From `backend/` in PowerShell, configure a development database before opting in:

```powershell
$env:NODE_ENV = "development"
$env:MONGO_URI = "mongodb://127.0.0.1:27017/stm_test"
$env:STM_TEST_DATABASE_NAME = "stm_test"
$env:STM_TEST_DATA_CONFIRM = "YES"
$env:STM_TRAFFIC_SIMULATOR_ENABLED = "YES"
$env:STM_TRAFFIC_SIMULATOR_INTERVAL_MS = "15000"
$env:STM_TRAFFIC_SIMULATOR_DEVICE_COUNT = "3"
$env:STM_TRAFFIC_SIMULATOR_SCENARIO = "rush-hour"
$env:STM_TRAFFIC_SIMULATOR_SEED = "12345"
npm run dev
```

Only `NODE_ENV=development` and `STM_TRAFFIC_SIMULATOR_ENABLED=YES` enable it. Before writing, the simulator also requires `STM_TEST_DATA_CONFIRM=YES`, a safe test database name in `STM_TEST_DATABASE_NAME`, a valid MongoDB URI whose optional database path matches that name, and a connected database with the same name. Use a dedicated test cluster; the application can verify the database name but cannot independently identify whether a MongoDB host is production. The optional interval must be at least 1000 ms, device count must be 1–20, and the selected sensors must already belong to active locations. Select one scenario with `STM_TRAFFIC_SIMULATOR_SCENARIO`: `normal`, `rush-hour`, `heavy-congestion`, `incident`, or `recovery`. Rush-hour and congestion scenarios build progressively; recovery starts congested and clears progressively. Select a numeric seed for reproducible road-to-road variation. The simulator starts automatically with the backend when enabled and stops with normal backend shutdown; restart the backend to change scenarios. No public start/stop endpoint exists, and simulated measurement history is retained. This is generated test data, not a live traffic feed.

### Real-Time Dashboard Updates

The backend Socket.IO connection uses the existing `HS256` JWT session: the frontend sends its current token in the Socket.IO authentication handshake, not in the URL. Connections with missing, invalid, or unknown-role tokens are rejected. Authenticated users receive measurement, congestion, and alert lifecycle notifications, matching the authenticated read access of the existing traffic and alert APIs. Payloads contain only traffic/event identifiers and operational fields, not credentials or user profile data. Traffic Monitoring and Alerts & Analytics continue to load through REST first and refresh those feeds when notifications arrive; REST remains available when the socket is disconnected.

Congestion episodes are tracked per location. A `HIGH` or `SEVERE` measurement creates an event and alert only when no active episode exists at that location. Further high/severe readings reuse the active event. A `LOW` or `MEDIUM` reading clears all active events at that location and resolves their active alerts with the same `resolvedAt` timestamp. A later high/severe reading starts a new episode. These transitions emit `congestion-detected`, `alert-created`, `congestion-cleared`, and `alert-resolved` only after the corresponding document saves succeed. Processing is serialized per location and per alert event within one backend process. MongoDB partial unique indexes enforce at most one active congestion event per location and one active congestion alert per congestion event across backend processes; duplicate-key races return the winning record without publishing a second creation notification.

The two lifecycle indexes are created explicitly during backend startup after a read-only scan for conflicting active records. Mongoose automatic index creation is disabled for these models so an index cannot be built before the conflict scan. If existing duplicates are found, startup logs the affected location/event IDs and sample record IDs, creates neither index, and stops; it does not delete, resolve, or overwrite records. Review and reconcile such records through an explicit operator-reviewed data migration before restarting.

These unique indexes require the congestion-event and traffic-alert collections to be unsharded, or for the deployment's shard keys to be compatible with MongoDB's unique-index requirements. If MongoDB rejects index creation, startup fails closed and logs the error; verify the collection sharding/index constraints before allowing traffic processing.

### Durable Traffic-Measurement Processing Recovery

Each newly persisted measurement is created with internal processing state `PENDING`; older measurements without this metadata are not automatically reprocessed. The initial processing attempt still runs synchronously after measurement persistence, and the API keeps its existing success response for a saved measurement even when processing fails. Internal queue metadata is omitted from normal measurement API serialization.

The durable states are `PENDING` → `PROCESSING` → `COMPLETED`, with failures moving through `RETRY` back to `PROCESSING`, or to retained terminal `FAILED` after eight attempts. A job records its attempt count, next retry time, lease token/expiry, last completed stage, event/alert references, and a bounded error summary. Retries use exponential backoff starting at one second, capped at five minutes, with jitter. A periodic worker claims bounded batches using MongoDB updates. Expired processing leases are eligible for recovery after restart. The worker creates the processing-queue index only after the database connection and congestion lifecycle index preflight succeed.

Measurements are ordered by persistence timestamp and ID within each location. A durable per-location lease serializes work across backend processes; a future-due retry at the head of a location's queue blocks newer measurements at that location, while other locations can continue. Processing checkpoints allow recovery after event or alert persistence without intentionally creating a second active event/alert. Existing partial unique indexes and duplicate-key winner handling remain the final cross-process safeguards. On graceful shutdown the worker stops polling and drains active operations; after an abrupt process exit, recovery waits for the lease to expire.

Operational state is retained on the measurement documents but is not currently exposed through a management API or dashboard. Operators can inspect the `processing.status`, `processing.attempts`, `processing.nextAttemptAt`, and `processing.lastError` fields using approved database access. `FAILED` jobs are retained for investigation; there is no automatic or public replay endpoint. Socket.IO remains best-effort: a process crash after a persisted lifecycle change but before publication can still result in a missed live notification, although REST reads reflect the stored state. Lease expiry also has the usual distributed-worker limitation if a worker becomes unresponsive beyond its lease while still executing; the heartbeat reduces but does not eliminate that risk.

### Frontend Setup

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend will then be available through the local Vite development server.

---

## Database

The backend uses **MySQL** for persistent storage.

The database contains entities for areas such as:

- Users
- Traffic Signals
- Traffic Locations
- Traffic Measurements
- Traffic Alerts
- Traffic Incidents
- Emergency Vehicles
- Monitoring Devices
- Routes
- Congestion Events

Database configuration is maintained in:

```text
backend/config/database.js
```
### Computer Vision Integration — Work in Progress

**Phase 1 — Offline CV pipeline:** Implemented and unit-tested. Real-world inference remains unverified.

**Phase 3 — STM backend integration: INCOMPLETE**
- Upload, job, analysis, and worker service foundations exist.
- API controllers/routes are not yet implemented and registered.
- Realtime progress updates are not integrated.
- Worker startup/shutdown is not wired into the server lifecycle.
- Integration with standard `TrafficMeasurement` records is not implemented.
- End-to-end processing, authorization, and recovery remain to be verified.

**Phase 4 — Frontend interface: NOT IMPLEMENTED**
- Video upload interface, processing status, metrics display, annotated-video playback, and result downloads remain pending.

This checkpoint preserves ongoing development work. Phases 3 and 4 must not be represented as completed or production-ready.

---

## Future Development

Planned extensions include:

- AI-based traffic prediction
- Computer-vision-based incident detection
- IoT sensor integration
- Traffic simulation
- Advanced predictive analytics
- Real-time map visualization
- More sophisticated route optimization
- Integration with external traffic data sources

---

## Project Status

**Status:** Active Development

The current implementation focuses on the core frontend and backend architecture, traffic management modules, APIs, database integration, and intelligent traffic-management services.

AI and simulation components are planned for subsequent development.

---

## Contributors

Developed as part of a Software Engineering project.

---

## License

This project is currently intended for academic and educational purposes.
