const API_ROOT = "/api/v1";
let requestToken = "";

export class ApiError extends Error {
  constructor(message, status, problem = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }
}

async function decode(response) {
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.ok && body?.requestToken) requestToken = body.requestToken;
  if (!response.ok) {
    throw new ApiError(
      body?.detail || body?.title || (response.status === 403 ? "You do not have permission to perform this action. If you are signed in as Reception or Staff, click Sign out." : "The clinic queue service could not complete the request."),
      response.status,
      body,
    );
  }
  return body;
}

export async function refreshRequestToken() {
  const response = await fetch(`${API_ROOT}/auth/csrf`, { credentials: "same-origin" });
  const body = await decode(response);
  requestToken = body?.requestToken ?? "";
  return requestToken;
}

export function clearRequestToken() {
  requestToken = "";
}

export async function api(path, options = {}) {
  const method = (options.method ?? "GET").toUpperCase();
  const fetchOptions = { ...options };
  delete fetchOptions.csrf;
  const headers = new Headers(options.headers);
  const hasBody = options.body !== undefined;
  if (hasBody && !(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  if (!["GET", "HEAD", "OPTIONS"].includes(method) && options.csrf !== false) {
    if (!requestToken) await refreshRequestToken();
    headers.set("X-CSRF-TOKEN", requestToken);
  }

  const response = await fetch(`${API_ROOT}${path}`, {
    ...fetchOptions,
    method,
    headers,
    credentials: "same-origin",
  });
  return decode(response);
}

export const authApi = {
  session: (signal) => api("/auth/session", { signal }),
  async login(credentials) {
    await refreshRequestToken();
    return api("/auth/login", { method: "POST", body: JSON.stringify(credentials) });
  },
  async logout() {
    await api("/auth/logout", { method: "POST" });
    clearRequestToken();
  },
  changePassword: (credentials) => api("/auth/change-password", { method: "POST", body: JSON.stringify(credentials) }),
};

export const departmentApi = {
  list: (signal) => api("/departments", { signal }),
  adminList: (signal) => api("/admin/departments", { signal }),
  create: (department) => api("/admin/departments", { method: "POST", body: JSON.stringify(department) }),
  update: (id, changes) => api(`/admin/departments/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(changes) }),
};

export const usersApi = {
  list: (signal) => api("/admin/users", { signal }),
  create: (user) => api("/admin/users", { method: "POST", body: JSON.stringify(user) }),
  update: (id, changes) => api(`/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(changes) }),
  delete: (id) => api(`/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const servicesApi = {
  available: (signal) => api("/services/available", { signal }),
  list: (signal) => api("/admin/services", { signal }),
  create: (service) => api("/admin/services", { method: "POST", body: JSON.stringify(service) }),
  update: (id, changes) => api(`/admin/services/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(changes) }),
};

export const stationsApi = {
  list: (signal) => api("/admin/stations", { signal }),
  create: (station) => api("/admin/stations", { method: "POST", body: JSON.stringify(station) }),
  update: (id, changes) => api(`/admin/stations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(changes) }),
};

export const displaysApi = {
  list: (signal) => api("/admin/displays", { signal }),
  create: (display) => api("/admin/displays", { method: "POST", body: JSON.stringify(display) }),
  update: (id, changes) => api(`/admin/displays/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(changes) }),
  pairingCode: (id) => api(`/admin/displays/${encodeURIComponent(id)}/pairing-code`, { method: "POST" }),
  activate: (code) => api("/displays/activate", { method: "POST", body: JSON.stringify({ code }) }),
  async logout() {
    await api("/displays/logout", { method: "POST" });
    clearRequestToken();
  },
  snapshot: (signal) => api("/displays/me/snapshot", { signal }),
  lobbySnapshot: (signal) => api("/displays/me/lobby-snapshot", { signal }),
  lobbyVideos: (signal) => api("/displays/me/videos", { signal }),
  adminVideos: (signal) => api("/admin/display-videos", { signal }),
  addVideoUrl: (url) => api("/admin/display-videos/urls", { method: "POST", body: JSON.stringify({ url }) }),
  uploadVideo: (file) => {
    const body = new FormData();
    body.append("file", file);
    return api("/admin/display-videos/upload", { method: "POST", body });
  },
  deleteVideo: (id) => api(`/admin/display-videos/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const kiosksApi = {
  list: (signal) => api("/admin/kiosks", { signal }),
  create: (kiosk) => api("/admin/kiosks", { method: "POST", body: JSON.stringify(kiosk) }),
  update: (id, changes) => api(`/admin/kiosks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(changes) }),
  pairingCode: (id) => api(`/admin/kiosks/${encodeURIComponent(id)}/pairing-code`, { method: "POST" }),
};

export const kioskApi = {
  choices: (signal) => api("/kiosk/choices", { signal }),
  issue: (visit, key) => api("/kiosk/visits", {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify(visit),
  }),
  activate: (code) => api("/kiosks/activate", { method: "POST", body: JSON.stringify({ code }) }),
  logout: () => api("/kiosk/logout", { method: "POST" }),
};

export const visitsApi = {
  issue: (visit, key) => api("/visits", {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify(visit),
  }),
  get: (id, signal) => api(`/visits/${encodeURIComponent(id)}`, { signal }),
  receipt: (lookup, clinicDate, signal) => {
    const trimmed = typeof lookup === "string" ? lookup.trim() : "";
    const params = typeof lookup === "object" && lookup !== null
      ? { ...lookup, clinicDate }
      : /^\d{1,3}$/.test(trimmed)
        ? { visitCode: trimmed.padStart(3, "0"), clinicDate }
        : { referenceId: trimmed, clinicDate };
    const query = new URLSearchParams(params);
    return api(`/reception/visits/receipt?${query}`, { signal });
  },
};

export const queueApi = {
  get: (departmentId, signal) => api(`/departments/${encodeURIComponent(departmentId)}/queue`, { signal }),
  callNext: (departmentId, key) => api(`/departments/${encodeURIComponent(departmentId)}/call-next`, {
    method: "POST",
    headers: { "Idempotency-Key": key },
  }),
  returnToPending: (visitId, idempotencyKey) => api(`/visits/${encodeURIComponent(visitId)}/return-to-pending`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
  }),
  complete: (visitId, nextServiceId, nextDepartmentAppointmentAtLocal, idempotencyKey) => {
    const body = {};
    if (nextServiceId) body.nextServiceId = nextServiceId;
    if (nextServiceId && nextDepartmentAppointmentAtLocal) body.nextDepartmentAppointmentAtLocal = nextDepartmentAppointmentAtLocal;
    return api(`/visits/${encodeURIComponent(visitId)}/complete`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    });
  },
};
