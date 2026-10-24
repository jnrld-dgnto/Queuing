# Codebase Map

This map describes the current SPEC-005 queue, SPEC-006 Admin configuration, SPEC-007 local setup mode, SPEC-008 service-aware issue/forward workflow, SPEC-009 self-service kiosk, SPEC-010 lobby display, SPEC-011 Service-scoped Staff access, and SPEC-012 Department ticket numbering. Accepted scopes live in [`SPEC-005`](specs/005-forwarding-clinic-queue/spec.md), [`SPEC-006`](specs/006-service-station-admin-config/spec.md), [`SPEC-007`](specs/007-local-admin-setup-mode/spec.md), [`SPEC-008`](specs/008-service-aware-visit-issue/spec.md), [`SPEC-009`](specs/009-self-service-kiosk/spec.md), [`SPEC-010`](specs/010-multi-department-lobby-display/spec.md), [`SPEC-011`](specs/011-service-scoped-staff-access/spec.md), and [`SPEC-012`](specs/012-department-ticket-numbering/spec.md); operational readiness remains limited to local synthetic-data use.

## Backend

| Path | Responsibility |
|---|---|
| `backend/Queuing.Api/Program.cs` | ASP.NET Core composition root, MySQL/EF configuration, startup migration execution, Identity cookies, antiforgery, rate limits, policies, loopback-guarded local setup principal, health routes, SignalR, and outbox startup. |
| `backend/Queuing.Api/Auth/` | One-time admin bootstrap, role constants, Service/legacy Department queue authorization, separate DisplayDevice/KioskDevice authentication, password-change claims, and `LocalSetupAccess` checks. |
| `backend/Queuing.Api/Controllers/AuthController.cs` | Session, login/logout, CSRF token, and forced password change. |
| `backend/Queuing.Api/Controllers/AdminUsersController.cs` | Admin-provisioned accounts, roles, Service assignments, temporary credential, deletion safeguards, and audit. |
| `backend/Queuing.Api/Controllers/AdminServicesController.cs` | Admin-only Service configuration and audit. |
| `backend/Queuing.Api/Controllers/AdminStationsController.cs` | Admin-only physical Station configuration, same-department Service/Staff associations, and audit. |
| `backend/Queuing.Api/Controllers/DepartmentsController.cs` | Dynamic active department choices and admin create/update/deactivation; lobby refresh invalidation after active-set changes. |
| `backend/Queuing.Api/Controllers/DisplaysController.cs` | Admin Department/lobby display configuration and pairing; anonymous activation; Department-scoped snapshot and revocation. |
| `backend/Queuing.Api/Controllers/LobbyDisplaysController.cs` | Lobby-only all-active-department snapshot and paired-lobby video list/range reads. |
| `backend/Queuing.Api/Controllers/DisplayVideosController.cs` | Admin playlist URL/upload/list/removal, CSRF-protected audited writes, and local media storage paths. |
| `backend/Queuing.Api/Controllers/KiosksController.cs` | Admin kiosk lifecycle and pairing; narrow paired-device choices, walk-in issue, and logout endpoints. |
| `backend/Queuing.Api/Controllers/ReceptionVisitsController.cs` | Authenticated active-Service choices, service-based visit issue with optional Reference ID, visit-ID compatibility lookup, and audited original receipt lookup by clinic date/code or Chart/Reference ID. |
| `backend/Queuing.Api/Controllers/VisitCommandsController.cs` | Service-filtered Staff queue, assigned-Service call-next, no-show requeue, and current-Service-authorized complete/forward commands. |
| `backend/Queuing.Api/Services/VisitCommandSupport.cs` | Shared idempotency, clinic-time parsing, audit, and outbox helpers used by visit commands. |
| `backend/Queuing.Api/Services/VisitIssuanceService.cs` | Shared database transaction for Reception/kiosk issue, clinic and Department daily sequences, idempotency, issuer audit, and outbox. |
| `backend/Queuing.Api/Services/VisitCommandSupport.cs` | Shared idempotency, clinic-time parsing, transactional Department sequence allocation, audit, and outbox helpers. |
| `backend/Queuing.Api/Data/QueueDbContext.cs` | Identity, Department and Service staff assignments, Service/Station associations, Department/lobby display devices and video metadata, Kiosk devices, exclusive Visit issuer constraint, daily Department ticket counters, and clinic queue indexes. |
| `backend/Queuing.Api/Data/Migrations/` | MySQL initial schema, queue timestamp precision, Service/Station configuration, service-linked visit steps, kiosk device/issuer migration, Service-scoped Staff assignment/backfill, lobby display/video migration, Department sequence migration, Visit reference ID migration, and model snapshots. |
| `backend/Queuing.Api/Data/QueueDbContextFactory.cs` | EF design-time connection configuration for migrations. |
| `backend/Queuing.Api/Services/QueueOutboxDispatcher.cs` | Dispatches committed queue and Department-configuration invalidations only to active paired device-generation groups. |
| `backend/Queuing.Api/Hubs/QueueHub.cs` | Device-authenticated, per-display-generation notification groups for Department and lobby devices; no queue commands. |
| `backend/Queuing.Api/Services/DisplayMediaValidation.cs` | HTTPS direct-video URL checks, media signature detection, and the upload size limit. |
| `backend/Queuing.Api.Tests/` | Focused tests for setup access boundaries, Admin API path scoping, and display media validation. |
| `backend/Queuing.Core/DepartmentQueuePolicy.vb` | Framework-independent step transition and appointment eligibility rules. |
| `backend/Queuing.Core/QueueDemoStore.vb` | Historical in-memory demo implementation; not registered as the current API queue authority. |
| `backend/Queuing.Core.Tests/` | xUnit checks for legacy demo behavior and current VB.NET queue policy rules. |

## Frontend

| Path | Responsibility |
|---|---|
| `frontend/src/App.jsx` | Public Department/lobby display and kiosk routes plus the authenticated workspace route tree and Admin sign-out control. |
| `frontend/src/api/client.js` | Central same-origin `/api/v1` fetch client, antiforgery token, session, department/user/service/station/display/video/kiosk admin, visit, and queue API methods. Multipart upload leaves its boundary to the browser. |
| `frontend/src/auth/` | Login with password visibility, session provider with Service assignments, role guards, live password policy feedback, forced password change, and a Vite-only Admin login bypass that can be exited for the current browser tab session. Reception and Staff always use real role sessions. |
| `frontend/src/features/admin/AdminLayout.jsx` | Admin workspace heading and one-time staff/display/kiosk credential notices; hosts the selected configuration section. |
| `frontend/src/features/admin/AdminNavigation.jsx`, `adminSections.js` | Collapsible Admin sidebar group and direct routes for Departments, Services, Users & access, Stations, Displays, and Kiosks. |
| `frontend/src/features/admin/sections/` | One React page per admin configuration area; Departments supports deactivation/reactivation; Users supports account deletion with confirmation; Displays manages Department/lobby devices and the shared lobby video playlist. |
| `frontend/src/features/admin/components/` | Shared section heading and API feedback UI used by admin pages. |
| `frontend/src/features/reception/ReceptionPage.jsx` | Department ticket issue with optional Reference ID, visit-code/reference receipt lookup, and browser print. |
| `frontend/src/features/department/DepartmentQueuePage.jsx` | Service-scoped Department ticket rows, call-next, no-show requeue, completion, and forwarding. |
| `frontend/src/features/display/` | One-time pairing route, Department-number monitor, and multi-department lobby board with muted autoplay and a looping playlist. |
| `frontend/src/features/kiosk/` | Standalone kiosk pairing and responsive Department → Service → confirmation → Department ticket issue flow. |
| `frontend/tests/unit/` | API client, idempotency header, appointment payload, and role unit tests. |
| `frontend/tests/e2e/clinic-authenticated-workflows.spec.js` | Playwright UI workflows with mocked HTTP API responses, including lobby display setup, playlist management, and lobby queue presentation. |
| `frontend/tests/e2e/clinic-mysql-integration.spec.js` | Opt-in MySQL/API/browser workflow for local setup access, authenticated configuration, Service assignment/isolation and queue behavior, and both paired display scopes; uses a disposable `_test` database and a bootstrapped test admin. |

All HTTP API calls use the shared client. Display SignalR carries only `QueueChanged` invalidations; each screen reloads its scoped REST snapshot. Lobby credentials can read all active Department projections and uploaded playlist media; Department credentials remain restricted to one Department.

## Current boundaries and gaps

- Current stack is C# ASP.NET Core 10 API, VB.NET core, and React JavaScript/Vite. No incidental language or framework migration is approved.
- MySQL 8.x/InnoDB is the selected database for SPEC-005, recorded in [ADR-0002](adr/0002-mysql-and-forwarding-visits.md). Earlier PostgreSQL references are architectural proposals or historical specs.
- SPEC-006 adds dynamic Services and physical Stations to Admin configuration. SPEC-008 uses active Services for Reception issue and Staff forwarding; SPEC-011 scopes Staff queue reads/actions to assigned Services, while Department displays remain department-scoped. Stations still do not affect queue actions.
- Department ticket numbers are independently allocated per Department and Asia/Manila clinic date; forwarded steps receive a number in their destination Department. The stable clinic-wide visit code remains unchanged for lookup and continuity. Reception reprints by `{ visitCode, clinicDate }`; older visit-ID lookup remains available.
- `/display/pair`, `/display`, and `/display/lobby` bypass the staff sign-in route. Pairing is one-time and rate limited; the API stores a hash of the revocable device credential. Department monitors retain one Department scope; lobby displays see every active Department with the latest call and up to three waiting codes.
- `/kiosk/pair` and `/kiosk` bypass staff sign-in with a different device cookie and policy. Kiosks see only active Department/Service choices and issue walk-in tickets; device actor IDs are recorded on Visits and audit rows.
- SPEC-007 opens Admin directly in Vite development. Reception and Department routes require a real session, and signed-in users are routed to their own role workspace. The API adds unauthenticated Admin role claims only to anonymous `/api/v1/admin/*` requests when enabled in Development and both Host and remote address are loopback; Reception and Staff API routes and production frontend builds retain normal authentication.
- Display projections contain Department labels and anonymous visit codes only; they omit patient identity, appointment time, and staff information. Uploaded video is stored under the configured local App_Data path, outside the static web root, and served only to paired lobby devices.
- `skills/` contains agent guidance, not application code. `skills/project-knowledge/` applies repository-wide; `skills/clinic-queue/` covers queue/security/persistence; `skills/render/` covers frontend work.
- SPEC-008's MySQL 8.4 migration/bootstrap, service-aware issue/forward, receipt lookup, authorization, and browser workflow were previously recorded as passing. Current local verification builds the solution, passes API/Core tests, frontend lint/build/unit and authenticated mocked workflows, plus the opt-in MySQL/API/browser workflow. SPEC-011's migration backfill was also exercised with pre-feature synthetic Department assignments. Physical printer behavior, target-device video/audio playback, production deployment, and multi-instance storage remain unverified/out of scope.

For directory layout and growth rules, see [`STRUCTURE.md`](STRUCTURE.md). For the queue, configuration, setup, service-aware workflow, kiosk, multi-department display, Service-scoped Staff access, and Department numbering briefs, see [`SPEC-005`](specs/005-forwarding-clinic-queue/spec.md), [`SPEC-006`](specs/006-service-station-admin-config/spec.md), [`SPEC-007`](specs/007-local-admin-setup-mode/spec.md), [`SPEC-008`](specs/008-service-aware-visit-issue/spec.md), [`SPEC-009`](specs/009-self-service-kiosk/spec.md), [`SPEC-010`](specs/010-multi-department-lobby-display/spec.md), [`SPEC-011`](specs/011-service-scoped-staff-access/spec.md), and [`SPEC-012`](specs/012-department-ticket-numbering/spec.md).
