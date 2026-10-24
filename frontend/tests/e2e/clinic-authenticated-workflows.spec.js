import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";

async function mockApi(page, initialRole = null, forcePasswordChange = false, options = {}) {
  let role = initialRole;
  let mustChangePassword = false;
  const departments = [
    { id: "dept-xray", name: "X-ray", active: true },
    { id: "dept-ecg", name: "ECG", active: true },
  ];
  const availableServices = options.availableServices ?? [
    { id: "service-xray", name: "Imaging", departmentId: "dept-xray", departmentName: "X-ray", active: true },
    { id: "service-ecg", name: "ECG test", departmentId: "dept-ecg", departmentName: "ECG", active: true },
  ];
  const users = [];
  const displays = [];
  const services = [];
  const stations = [];
  const videos = options.videos ?? [];
  const requests = [];
  let paired = false;
  let displayType = options.displayType ?? "Department";
  const waiting = [{ id: "visit-2", visitCode: "Q-002", ticketNumber: "002", serviceId: "service-xray", serviceName: "Imaging", issuedAtUtc: "2026-10-20T00:00:00Z" }];
  const called = [];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    let body = {};
    try { body = request.postDataJSON?.() ?? {}; } catch { /* multipart uploads have no JSON body */ }
    requests.push({ path, query: url.search, method, headers: request.headers(), body });
    const json = (payload, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });

    if (path === "/auth/csrf" && method === "GET") return json({ requestToken: "test-token" });
    if (path === "/auth/session" && method === "GET") return json(role
      ? { authenticated: true, userName: "clinic-user", role, departmentIds: role === "Staff" ? ["dept-xray"] : [], serviceIds: role === "Staff" ? ["service-xray"] : [], mustChangePassword }
      : { authenticated: false, userName: null, role: null, departmentIds: [], requestToken: "test-token" });
    if (path === "/auth/login" && method === "POST") { role = "Reception"; mustChangePassword = forcePasswordChange; return route.fulfill({ status: 204 }); }
    if (path === "/auth/logout" && method === "POST") { role = null; return route.fulfill({ status: 204 }); }
    if (path === "/auth/change-password" && method === "POST") { mustChangePassword = false; return route.fulfill({ status: 204 }); }
    if (path === "/departments" && method === "GET") return json(departments);
    if (path === "/services/available" && method === "GET") {
      if (options.serviceLoadError) return route.fulfill({ status: 503, contentType: "application/problem+json", body: JSON.stringify({ detail: "Service choices are temporarily unavailable." }) });
      return json(availableServices);
    }
    if (path === "/admin/departments" && method === "GET") return json(departments);
    if (path === "/admin/departments" && method === "POST") {
      const created = { id: "dept-new", name: body.name, active: true };
      departments.push(created);
      return json(created, 201);
    }
    if (path.startsWith("/admin/departments/") && method === "PATCH") {
      const department = departments.find((item) => item.id === path.split("/").at(-1));
      Object.assign(department, body);
      return json(department);
    }
    if (path === "/admin/users" && method === "GET") return json(users);
    if (path === "/admin/users" && method === "POST") {
      const serviceIds = body.serviceIds ?? [];
      const departmentIds = [...new Set(serviceIds.map((id) => services.find((service) => service.id === id)?.departmentId).filter(Boolean))];
      const created = { id: "user-new", userName: body.userName, role: body.role, departmentIds, serviceIds, active: true };
      users.push(created);
      return json({ ...created, oneTimeCredential: "one-time-secret" }, 201);
    }
    if (path.startsWith("/admin/users/") && method === "PATCH") {
      const user = users.find((item) => item.id === path.split("/").at(-1));
      Object.assign(user, body);
      if (!user.active || user.role !== "Staff") {
        for (const station of stations) station.staffUserIds = station.staffUserIds.filter((id) => id !== user.id);
      }
      return json(user);
    }
    if (path.startsWith("/admin/users/") && method === "DELETE") {
      if (options.deleteUserError) return route.fulfill({ status: 409, contentType: "application/problem+json", body: JSON.stringify({ title: "This account has visit history.", detail: "Deactivate it to keep those records." }) });
      users.splice(users.findIndex((item) => item.id === path.split("/").at(-1)), 1);
      return route.fulfill({ status: 204 });
    }
    if (path === "/admin/services" && method === "GET") return json(services);
    if (path === "/admin/services" && method === "POST") {
      const created = { id: "service-new", ...body, active: true };
      services.push(created);
      return json(created, 201);
    }
    if (path.startsWith("/admin/services/") && method === "PATCH") {
      const service = services.find((item) => item.id === path.split("/").at(-1));
      Object.assign(service, body);
      return json(service);
    }
    if (path === "/admin/stations" && method === "GET") return json(stations);
    if (path === "/admin/stations" && method === "POST") {
      const created = { id: "station-new", serviceIds: [], staffUserIds: [], ...body, active: true };
      stations.push(created);
      return json(created, 201);
    }
    if (path.startsWith("/admin/stations/") && method === "PATCH") {
      const station = stations.find((item) => item.id === path.split("/").at(-1));
      Object.assign(station, body);
      return json(station);
    }
    if (path === "/admin/displays" && method === "GET") return json(displays);
    if (path === "/admin/displays" && method === "POST") {
      const created = { id: "display-new", ...body, type: body.departmentId ? "Department" : "Lobby", active: true };
      displays.push(created);
      return json(created, 201);
    }
    if (path.startsWith("/admin/displays/") && method === "PATCH") {
      const display = displays.find((item) => item.id === path.split("/").at(-1));
      Object.assign(display, body);
      return json(display);
    }
    if (path.endsWith("/pairing-code") && method === "POST") return json({ code: "PAIR-1234" });
    if (path === "/displays/activate" && method === "POST") { paired = true; return json({ paired: true, displayType }); }
    if (path === "/admin/display-videos" && method === "GET") return json(videos);
    if (path === "/admin/display-videos/urls" && method === "POST") {
      const video = { id: `video-${videos.length + 1}`, name: new URL(body.url).pathname.split("/").at(-1), url: body.url, contentType: "video/mp4" };
      videos.push(video);
      return json(video, 201);
    }
    if (path === "/admin/display-videos/upload" && method === "POST") {
      const video = { id: `video-${videos.length + 1}`, name: "clinic-info.webm", url: null, contentType: "video/webm" };
      videos.push(video);
      return json(video, 201);
    }
    if (path.startsWith("/admin/display-videos/") && method === "DELETE") {
      videos.splice(videos.findIndex((video) => path.endsWith(video.id)), 1);
      return route.fulfill({ status: 204 });
    }
    if (path === "/displays/me/lobby-snapshot" && method === "GET") return paired && displayType === "Lobby"
      ? json([
        { departmentName: "ECG", called: "001", waiting: ["002", "003"] },
        { departmentName: "X-ray", called: null, waiting: ["008", "009", "010"] },
      ])
      : route.fulfill({ status: 403, contentType: "application/problem+json", body: JSON.stringify({ title: "Forbidden" }) });
    if (path === "/displays/me/videos" && method === "GET") return paired && displayType === "Lobby"
      ? json(videos.map((video) => ({ id: video.id, url: video.url ?? "/api/v1/displays/me/videos/video-1/content" })))
      : route.fulfill({ status: 403, contentType: "application/problem+json", body: JSON.stringify({ title: "Forbidden" }) });
    if (path === "/displays/me/snapshot" && method === "GET") return paired
      ? json({ departmentName: "X-ray", waiting: [{ visitCode: "Q-002", ticketNumber: "002", status: "Pending" }], called: [{ visitCode: "Q-001", ticketNumber: "001", status: "Called" }] })
      : route.fulfill({ status: 401, contentType: "application/problem+json", body: JSON.stringify({ title: "Unauthorized" }) });
    if (path === "/departments/dept-xray/queue" && method === "GET") return json({ waiting, called });
    if (path === "/departments/dept-xray/call-next" && method === "POST") {
      const next = waiting.shift();
      if (!next) return route.fulfill({ status: 409, contentType: "application/problem+json", body: JSON.stringify({ detail: "No eligible visits are waiting." }) });
      called.push(next);
      return json(next);
    }
    if (path.startsWith("/visits/") && path.endsWith("/return-to-pending") && method === "POST") {
      const id = path.split("/")[2];
      const index = called.findIndex((visit) => visit.id === id);
      if (index >= 0) waiting.unshift(called.splice(index, 1)[0]);
      return route.fulfill({ status: 204 });
    }
    if (path.startsWith("/visits/") && path.endsWith("/complete") && method === "POST") {
      const id = path.split("/")[2];
      const index = called.findIndex((visit) => visit.id === id);
      if (index >= 0) called.splice(index, 1);
      return json({ id, visitCode: "Q-002", completed: false, nextDepartmentId: "dept-ecg", nextServiceId: body.nextServiceId, nextDepartmentTicketNumber: 3 });
    }
    if (path === "/visits" && method === "POST") {
      const service = availableServices.find((item) => item.id === body.initialServiceId);
      return json({ id: "visit-new", visitCode: "003", ticketNumber: "001", departmentTicketNumber: 1, clinicDate: "2026-10-21", serviceId: service.id, serviceName: service.name, departmentId: service.departmentId, departmentName: service.departmentName, appointmentAtUtc: null, issuedAtUtc: "2026-10-20T00:00:00Z" }, 201);
    }
    if (path === "/reception/visits/receipt" && method === "GET") return json({ id: "visit-new", visitCode: url.searchParams.get("visitCode"), ticketNumber: "001", departmentTicketNumber: 1, clinicDate: url.searchParams.get("clinicDate"), serviceId: "service-xray", serviceName: "Imaging", departmentId: "dept-xray", departmentName: "X-ray", issuedAtUtc: "2026-10-20T00:00:00Z", isReprint: true });
    return route.fulfill({ status: 404, contentType: "application/problem+json", body: JSON.stringify({ detail: `Unhandled mock route: ${method} ${path}` }) });
  });
  return { requests, departments };
}

test("sign-in and route guards keep the Reception workspace role scoped", async ({ page }) => {
  const { requests } = await mockApi(page);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Username").fill("receptionist");
  await page.getByLabel("Password").fill("test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/reception$/);
  await expect(page.getByRole("heading", { name: "Issue a visit" })).toBeVisible();
  expect(requests.find((entry) => entry.path === "/auth/login").headers["x-csrf-token"]).toBe("test-token");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/reception$/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("first sign-in requires a password change before entering a protected workspace", async ({ page }) => {
  const { requests } = await mockApi(page, null, true);
  await page.goto("/login");
  await page.getByLabel("Username").fill("new-staff");
  await page.getByLabel("Password").fill("temporary-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/change-password$/);
  await page.goto("/reception");
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByRole("textbox", { name: "Temporary password" }).fill("temporary-password");
  await page.getByRole("button", { name: "Show entered characters" }).first().click();
  await expect(page.getByRole("textbox", { name: "Temporary password" })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide entered characters" }).first().click();
  await page.getByLabel("New password", { exact: true }).fill("short");
  await expect(page.getByRole("list", { name: "Password requirements" })).toContainText("At least 12 characters");
  await expect(page.getByRole("button", { name: "Change password" })).toBeDisabled();
  await page.getByLabel("New password", { exact: true }).fill("Private-password1");
  await page.getByLabel("Confirm new password").fill("Private-password1");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page).toHaveURL(/\/reception$/);
  expect(requests.find((entry) => entry.path === "/auth/change-password").body).toEqual({ currentPassword: "temporary-password", newPassword: "Private-password1" });
});

test("admin can configure each section through the sidebar and sees only the selected section", async ({ page }) => {
  const behavior = { deleteUserError: true };
  const { requests } = await mockApi(page, "Admin", false, behavior);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/departments$/);
  await expect(page.getByRole("heading", { name: "Clinic configuration" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Departments" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Services" })).toHaveCount(0);
  const adminMenu = page.getByRole("button", { name: /Administration/ });
  await expect(adminMenu).toHaveAttribute("aria-expanded", "true");
  await adminMenu.click();
  await expect(adminMenu).toHaveAttribute("aria-expanded", "false");
  await adminMenu.click();
  await page.getByRole("button", { name: "Add department" }).click();
  await page.getByLabel("Department name").fill("Ultrasound");
  await page.getByRole("button", { name: "Save department" }).click();
  await expect(page.getByRole("region", { name: "Departments" }).getByText("Ultrasound", { exact: true })).toBeVisible();

  const ecgDepartment = page.locator(".admin-department-list li").filter({ hasText: "ECG" });
  await ecgDepartment.getByRole("button", { name: "Deactivate" }).click();
  await expect(ecgDepartment.locator(".enabled-label")).toHaveText("Inactive");
  await ecgDepartment.getByRole("button", { name: "Reactivate" }).click();
  await expect(ecgDepartment.locator(".enabled-label")).toHaveText("Active");
  await expect(page.getByText("ECG reactivated.")).toBeVisible();
  expect(requests.filter((entry) => entry.path === "/admin/departments/dept-ecg" && entry.method === "PATCH").at(-1).body).toEqual({ active: true });

  await page.getByRole("link", { name: /^Services\b/ }).click();
  await expect(page).toHaveURL(/\/admin\/services$/);
  await expect(page.getByRole("region", { name: "Departments" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add service" }).click();
  await page.getByLabel("Service name").fill("X-ray Imaging");
  await page.getByLabel("Service department").selectOption("dept-xray");
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(page.getByRole("region", { name: "Services" }).getByText("X-ray Imaging", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Users & access" }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByRole("region", { name: "Services" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add user" }).click();
  await page.getByLabel("Username", { exact: true }).fill("new-staff");
  await page.getByLabel("Role", { exact: true }).last().selectOption("Staff");
  await page.getByLabel("Services for staff").selectOption(["service-new"]);
  await page.getByRole("button", { name: "Provision user" }).click();
  await expect(page.getByText("one-time-secret")).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveCount(0);
  expect(requests.find((entry) => entry.path === "/admin/users" && entry.method === "POST").body)
    .toMatchObject({ role: "Staff", serviceIds: ["service-new"] });

  await page.getByRole("link", { name: "Stations" }).click();
  await expect(page).toHaveURL(/\/admin\/stations$/);
  await page.getByRole("button", { name: "Add station" }).click();
  await page.getByLabel("Station name").fill("Window 1");
  await page.getByLabel("Station department").selectOption("dept-xray");
  await page.getByLabel("Services handled").selectOption("service-new");
  await page.getByLabel("Assigned staff").selectOption("user-new");
  await page.getByRole("button", { name: "Save station" }).click();
  const stationRegion = page.getByRole("region", { name: "Stations" });
  await expect(stationRegion.getByText("Window 1", { exact: true })).toBeVisible();
  await expect(stationRegion.locator(".admin-record-summary")).toContainText("X-ray Imaging");
  await expect(stationRegion.getByText("new-staff", { exact: true })).toBeVisible();
  const savedStationForm = stationRegion.locator(".admin-record form");
  await stationRegion.getByRole("button", { name: "Edit station" }).click();
  await savedStationForm.getByLabel("Station name").fill("Window 1 Front Desk");
  await savedStationForm.getByRole("button", { name: "Save station" }).click();
  await expect(stationRegion.getByText("Window 1 Front Desk", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Users & access" }).click();
  const savedUserRecord = page.getByRole("region", { name: "Users & access" }).locator(".admin-record").filter({ hasText: "new-staff" });
  await savedUserRecord.getByRole("button", { name: "Edit access" }).click();
  const savedUserForm = savedUserRecord.locator("form");
  await savedUserForm.getByLabel("Active").uncheck();
  await savedUserForm.getByRole("button", { name: "Save user access" }).click();
  await expect(page.getByText("one-time-secret")).toBeVisible();

  await savedUserRecord.getByRole("button", { name: "Edit access" }).click();
  const roleChangeForm = savedUserRecord.locator("form");
  await roleChangeForm.getByLabel("Role").selectOption("Reception");
  await roleChangeForm.getByRole("button", { name: "Save user access" }).click();
  const roleChangeRequest = requests.filter((entry) => entry.path === "/admin/users/user-new" && entry.method === "PATCH").at(-1);
  expect(roleChangeRequest.body).toMatchObject({ role: "Reception", serviceIds: [] });

  await page.getByRole("link", { name: "Stations" }).click();
  const refreshedStationRegion = page.getByRole("region", { name: "Stations" });
  await expect(refreshedStationRegion.getByText("No staff assigned")).toBeVisible();
  await page.getByRole("link", { name: "Users & access" }).click();
  const deleteRecord = page.getByRole("region", { name: "Users & access" }).locator(".admin-record").filter({ hasText: "new-staff" });
  await deleteRecord.getByRole("button", { name: "Delete user" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("permanently removes this account");
  await expect(page.getByRole("alertdialog").getByRole("button", { name: "Cancel" })).toHaveCSS("color", "rgb(32, 50, 49)");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await deleteRecord.getByRole("button", { name: "Delete user" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete user" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Deactivate it to keep those records.");
  behavior.deleteUserError = false;
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete user" }).click();
  await expect(deleteRecord).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(requests.some((entry) => entry.path === "/admin/users/user-new" && entry.method === "DELETE")).toBe(true);

  await page.getByRole("link", { name: "Stations" }).click();
  await page.getByRole("link", { name: "Displays" }).click();
  await expect(page).toHaveURL(/\/admin\/displays$/);
  await page.getByRole("button", { name: "Add display" }).click();
  await page.getByLabel("Display name").fill("X-ray Waiting Room");
  await page.getByLabel("Assigned department", { exact: true }).selectOption("dept-xray");
  await page.getByRole("button", { name: "Save display" }).click();
  await expect(page.getByText("X-ray Waiting Room", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create pairing code" }).click();
  await expect(page.getByText("PAIR-1234")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open pairing page in a new tab" })).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: "Open pairing page in a new tab" })).toHaveAttribute("href", "/display/pair");
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/stations$/);
  await expect(page.getByRole("region", { name: "Stations" })).toBeVisible();
  await page.goto("/admin/services");
  await page.reload();
  await expect(page).toHaveURL(/\/admin\/services$/);
  await expect(page.getByRole("region", { name: "Services" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Stations" })).toHaveCount(0);
});

test("reception issues a service-linked Asia/Manila appointment and reprints by clinic date and visit code", async ({ page }) => {
  const { requests } = await mockApi(page, "Reception");
  await page.addInitScript(() => { window.print = () => { window.printRequested = true; }; });
  await page.goto("/reception");
  await expect(page.getByRole("heading", { name: "Issue a visit" })).toBeVisible();
  await page.getByLabel("Appointment time Optional").fill("2026-10-20T09:30");
  await page.getByRole("button", { name: "Issue visit" }).click();
  await expect(page.locator(".receipt-number")).toHaveText("001");
  await expect(page.locator(".receipt-reference")).toContainText("003");
  await expect(page.locator(".reception-toast")).toBeVisible();
  await expect(page.locator(".reception-toast-message")).toHaveText("Ticket 001 issued for Imaging.");
  await page.getByRole("button", { name: "Close notification" }).click();
  await expect(page.locator(".reception-toast")).toHaveCount(0);
  const issued = requests.find((entry) => entry.path === "/visits" && entry.method === "POST");
  expect(issued.body).toEqual({ initialServiceId: "service-xray", appointmentAtLocal: "2026-10-20T09:30" });
  expect(issued.headers["idempotency-key"]).toBeTruthy();
  await page.getByRole("button", { name: "Print / reprint" }).click();
  await expect.poll(() => page.evaluate(() => window.printRequested)).toBe(true);
  await page.getByRole("textbox", { name: "Visit code" }).fill("003");
  await page.getByLabel("Clinic date").fill("2026-10-21");
  await page.getByRole("button", { name: "Find visit" }).click();
  await expect(page.locator(".receipt-number")).toHaveText("001");
  await expect(page.locator(".receipt-reference")).toContainText("003");
  await expect(page.locator(".receipt-reprint-banner")).toBeVisible();
  await expect(page.locator(".reception-reprint-tag")).toHaveText("Reprint");
  const receiptLookup = requests.find((entry) => entry.path.startsWith("/reception/visits/receipt"));
  expect(receiptLookup).toMatchObject({ path: "/reception/visits/receipt", query: "?visitCode=003&clinicDate=2026-10-21" });
});

test("reception explains when no active services are configured", async ({ page }) => {
  await mockApi(page, "Reception", false, { availableServices: [] });
  await page.goto("/reception");
  await expect(page.getByText("No active services are available.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Issue visit" })).toBeDisabled();
});

test("reception reports service-choice loading failures", async ({ page }) => {
  await mockApi(page, "Reception", false, { serviceLoadError: true });
  await page.goto("/reception");
  await expect(page.getByRole("alert")).toContainText("Service choices are temporarily unavailable.");
  await expect(page.getByRole("button", { name: "Issue visit" })).toBeDisabled();
});

test("assigned staff can call, return a no-show, and complete a visit", async ({ page }) => {
  const { requests } = await mockApi(page, "Staff");
  await page.goto("/department");
  await expect(page.getByRole("heading", { name: "Department queue" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Imaging", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Call next" }).click();
  await expect(page.locator(".action-message[role='status']")).toContainText("Now calling 002");
  await page.getByRole("button", { name: "Return no-show to pending" }).first().click();
  await expect(page.getByText("002 returned to pending.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Call next" }).click();
  await page.getByLabel("Forward to service").selectOption("service-ecg");
  await page.getByRole("button", { name: "Complete / forward" }).first().click();
  await expect(page.getByText("Forwarded with destination ticket 003.", { exact: true })).toBeVisible();
  expect(requests.find((entry) => entry.path === "/visits/visit-2/complete").body).toEqual({ nextServiceId: "service-ecg" });
});

test("paired display uses its device session without requiring staff sign-in", async ({ page }) => {
  const { requests } = await mockApi(page);
  await page.route("**/hubs/displays/negotiate**", (route) => route.fulfill({ status: 404, body: "Hub not running in UI mock" }));
  await page.goto("/display/pair");
  await page.getByLabel("Pairing code").fill("PAIR-1234");
  await page.getByRole("button", { name: "Activate display" }).click();
  await expect(page).toHaveURL(/\/display$/);
  await expect(page.getByRole("heading", { name: "X-ray" })).toBeVisible();
  await expect(page.getByText("001", { exact: true })).toBeVisible();
  expect(requests.some((entry) => entry.path === "/auth/session")).toBe(false);
  expect(requests.some((entry) => entry.path === "/displays/me/snapshot")).toBe(true);
  expect(requests.find((entry) => entry.path === "/displays/activate").headers["x-csrf-token"]).toBe("test-token");
});

test("admin registers a lobby display and manages URL and uploaded playlist videos", async ({ page }) => {
  const { requests } = await mockApi(page, "Admin");
  await page.goto("/admin/displays");
  await page.getByRole("button", { name: "Add display" }).click();
  await page.getByLabel("Display name").fill("Main Lobby");
  await page.getByLabel("Display type").selectOption("Lobby");
  await page.getByRole("button", { name: "Save display" }).click();
  await expect(page.getByText("Main Lobby", { exact: true })).toBeVisible();
  await expect(page.locator(".admin-record-summary").filter({ hasText: "Main Lobby" })).toContainText("All active departments");

  await page.getByLabel("Direct HTTPS video URL (.mp4 or .webm)").fill("https://media.example.org/welcome.mp4");
  await page.getByRole("button", { name: "Add video URL" }).click();
  await expect(page.getByText("welcome.mp4", { exact: true })).toBeVisible();
  await page.getByLabel("Upload a video (MP4 or WebM, up to 250 MiB)").setInputFiles({
    name: "clinic-info.webm",
    mimeType: "video/webm",
    buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x93]),
  });
  await page.getByRole("button", { name: "Upload video" }).click();
  await expect(page.getByText("clinic-info.webm", { exact: true })).toBeVisible();
  expect(requests.find((entry) => entry.path === "/admin/display-videos/upload").headers["content-type"]).toContain("multipart/form-data; boundary=");
  await page.locator(".admin-video-list li").filter({ hasText: "clinic-info.webm" }).getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("clinic-info.webm", { exact: true })).toHaveCount(0);
});

test("paired lobby display shows active department calls, three waiting codes, and video start", async ({ page }) => {
  const { requests } = await mockApi(page, null, false, {
    displayType: "Lobby",
    videos: [{ id: "video-1", name: "welcome.mp4", url: "https://media.example.org/info.mp4", contentType: "video/mp4" }],
  });
  await page.route("**/hubs/displays/negotiate**", (route) => route.fulfill({ status: 404, body: "Hub not running in UI mock" }));
  await page.route("https://media.example.org/info.mp4", (route) => route.fulfill({ status: 200, contentType: "video/mp4", body: "" }));
  await page.goto("/display/pair");
  await page.getByLabel("Pairing code").fill("PAIR-1234");
  await page.getByRole("button", { name: "Activate display" }).click();
  await expect(page).toHaveURL(/\/display\/lobby$/);
  await expect(page.getByRole("heading", { name: "Now serving" })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "ECG" })).toContainText("001");
  await expect(page.getByRole("article").filter({ hasText: "X-ray" })).toContainText("010");
  await expect(page.getByRole("button", { name: /Enable video sound|Play video with sound/ })).toBeVisible();
  await expect(page.locator("video")).toHaveAttribute("autoplay", "");
  await expect(page.locator("video")).toHaveJSProperty("muted", true);
  expect(requests.some((entry) => entry.path === "/displays/me/lobby-snapshot")).toBe(true);
  expect(requests.some((entry) => entry.path === "/displays/me/videos")).toBe(true);
  expect(requests.some((entry) => entry.path === "/auth/session")).toBe(false);
});
