import assert from "node:assert/strict";
import test from "node:test";
import { api, authApi, clearRequestToken, displaysApi, queueApi, refreshRequestToken, servicesApi, stationsApi, visitsApi } from "../../src/api/client.js";

test("cookie-authenticated mutations obtain and send the antiforgery token", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options) => {
    requests.push({ url: String(input), options });
    return requests.length === 1
      ? new Response(JSON.stringify({ requestToken: "csrf-test" }), { status: 200 })
      : new Response(JSON.stringify({ id: "department-1" }), { status: 201 });
  };
  clearRequestToken();

  try {
    await api("/admin/departments", { method: "POST", body: JSON.stringify({ name: "X-ray" }) });
    assert.equal(requests[0].url, "/api/v1/auth/csrf");
    assert.equal(requests[1].options.credentials, "same-origin");
    assert.equal(requests[1].options.headers.get("X-CSRF-TOKEN"), "csrf-test");
    assert.equal(requests[1].options.headers.get("Content-Type"), "application/json");
  } finally {
    globalThis.fetch = originalFetch;
    clearRequestToken();
  }
});

test("CSRF token endpoint sets a request token in memory", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ requestToken: "session-token" }), { status: 200 });
  try {
    assert.equal(await refreshRequestToken(), "session-token");
  } finally {
    globalThis.fetch = originalFetch;
    clearRequestToken();
  }
});

test("multipart uploads leave Content-Type boundary to the browser", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options) => {
    requests.push({ url: String(input), options });
    return requests.length === 1
      ? new Response(JSON.stringify({ requestToken: "upload-token" }), { status: 200 })
      : new Response(JSON.stringify({ id: "video-1" }), { status: 201 });
  };
  clearRequestToken();

  try {
    const body = new FormData();
    body.append("file", new Blob(["video"]), "welcome.mp4");
    await api("/admin/display-videos/upload", { method: "POST", body });
    assert.equal(requests[1].options.headers.get("X-CSRF-TOKEN"), "upload-token");
    assert.equal(requests[1].options.headers.has("Content-Type"), false);
    assert.equal(requests[1].options.body, body);
  } finally {
    globalThis.fetch = originalFetch;
    clearRequestToken();
  }
});

test("login response replaces the anonymous CSRF token before authenticated mutations", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options) => {
    requests.push({ url: String(input), options });
    if (requests.length === 1) return new Response(JSON.stringify({ requestToken: "anonymous-token" }), { status: 200 });
    if (requests.length === 2) return new Response(JSON.stringify({ authenticated: true, requestToken: "signed-in-token" }), { status: 200 });
    return new Response(JSON.stringify({ id: "department-1" }), { status: 201 });
  };
  clearRequestToken();

  try {
    await authApi.login({ userName: "reception", password: "test-password" });
    await api("/admin/departments", { method: "POST", body: JSON.stringify({ name: "X-ray" }) });
    assert.equal(requests[1].options.headers.get("X-CSRF-TOKEN"), "anonymous-token");
    assert.equal(requests[2].options.headers.get("X-CSRF-TOKEN"), "signed-in-token");
  } finally {
    globalThis.fetch = originalFetch;
    clearRequestToken();
  }
});

test("anonymous display pairing obtains an antiforgery token without a staff session", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options) => {
    requests.push({ url: String(input), options });
    return requests.length === 1
      ? new Response(JSON.stringify({ requestToken: "display-csrf" }), { status: 200 })
      : new Response(JSON.stringify({ paired: true }), { status: 200 });
  };
  clearRequestToken();

  try {
    await displaysApi.activate("PAIR-123456");
    assert.equal(requests[0].url, "/api/v1/auth/csrf");
    assert.equal(requests[1].url, "/api/v1/displays/activate");
    assert.equal(requests[1].options.headers.get("X-CSRF-TOKEN"), "display-csrf");
    assert.equal(requests[1].options.credentials, "same-origin");
  } finally {
    globalThis.fetch = originalFetch;
    clearRequestToken();
  }
});

test("queue transitions carry idempotency keys and only forward a supplied local appointment", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options) => {
    requests.push({ url: String(input), options });
    if (requests.length === 1) return new Response(JSON.stringify({ requestToken: "csrf-test" }), { status: 200 });
    return new Response(null, { status: 204 });
  };
  clearRequestToken();

  try {
    await queueApi.returnToPending("visit-1", "retry-key-1");
    await queueApi.complete("visit-2", "service-next", "2026-10-20T09:30", "retry-key-2");
    await queueApi.complete("visit-3", null, null, "retry-key-3");

    assert.equal(requests[1].options.headers.get("Idempotency-Key"), "retry-key-1");
    assert.equal(requests[2].options.headers.get("Idempotency-Key"), "retry-key-2");
    assert.deepEqual(JSON.parse(requests[2].options.body), {
      nextServiceId: "service-next",
      nextDepartmentAppointmentAtLocal: "2026-10-20T09:30",
    });
    assert.equal(requests[3].options.headers.get("Idempotency-Key"), "retry-key-3");
    assert.deepEqual(JSON.parse(requests[3].options.body), {});
  } finally {
    globalThis.fetch = originalFetch;
    clearRequestToken();
  }
});

test("visit operations use active services for issue and clinic-date receipt lookup", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options) => {
    requests.push({ url: String(input), options });
    if (requests.length === 1) return new Response(JSON.stringify({ requestToken: "reception-token" }), { status: 200 });
    return new Response(JSON.stringify([]), { status: 200 });
  };
  clearRequestToken();

  try {
    await servicesApi.available();
    await visitsApi.issue({ initialServiceId: "service-xray", appointmentAtLocal: "2026-10-21T09:30" }, "issue-key");
    await visitsApi.receipt("001", "2026-10-21");
    await visitsApi.receipt("CH-1042", "2026-10-21");

    assert.equal(requests[0].url, "/api/v1/services/available");
    assert.equal(requests[1].url, "/api/v1/visits");
    assert.equal(requests[1].options.headers.get("Idempotency-Key"), "issue-key");
    assert.deepEqual(JSON.parse(requests[1].options.body), {
      initialServiceId: "service-xray",
      appointmentAtLocal: "2026-10-21T09:30",
    });
    assert.equal(requests[2].url, "/api/v1/reception/visits/receipt?visitCode=001&clinicDate=2026-10-21");
    assert.equal(requests[3].url, "/api/v1/reception/visits/receipt?referenceId=CH-1042&clinicDate=2026-10-21");
  } finally {
    globalThis.fetch = originalFetch;
    clearRequestToken();
  }
});

test("admin service and station operations use the shared CSRF-aware API client", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options) => {
    requests.push({ url: String(input), options });
    return requests.length === 1
      ? new Response(JSON.stringify({ requestToken: "admin-config-token" }), { status: 200 })
      : new Response(JSON.stringify({ id: "config-1" }), { status: 201 });
  };
  clearRequestToken();

  try {
    await servicesApi.create({ name: "X-ray", departmentId: "dept-xray" });
    await stationsApi.update("station-1", { serviceIds: ["service-1"], staffUserIds: ["staff-1"] });

    assert.equal(requests[1].url, "/api/v1/admin/services");
    assert.equal(requests[1].options.headers.get("X-CSRF-TOKEN"), "admin-config-token");
    assert.deepEqual(JSON.parse(requests[1].options.body), { name: "X-ray", departmentId: "dept-xray" });
    assert.equal(requests[2].url, "/api/v1/admin/stations/station-1");
    assert.equal(requests[2].options.method, "PATCH");
    assert.equal(requests[2].options.headers.get("X-CSRF-TOKEN"), "admin-config-token");
    assert.deepEqual(JSON.parse(requests[2].options.body), { serviceIds: ["service-1"], staffUserIds: ["staff-1"] });
  } finally {
    globalThis.fetch = originalFetch;
    clearRequestToken();
  }
});
