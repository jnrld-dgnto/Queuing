import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { departmentApi, servicesApi } from "../../../api/client.js";
import AdminFeedback from "../components/AdminFeedback.jsx";
import AdminSectionHeader from "../components/AdminSectionHeader.jsx";

export default function ServicesSection() {
  const [departments, setDepartments] = useState([]);
  const [services, setServices] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      const [departmentRows, serviceRows] = await Promise.all([departmentApi.adminList(signal), servicesApi.list(signal)]);
      setDepartments(departmentRows);
      setServices(serviceRows);
    } catch (cause) {
      if (cause.name !== "AbortError") setError(cause.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  async function act(action, success) {
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const result = await action();
      setMessage(success);
      await load();
      return result;
    } catch (cause) {
      setError(cause.message);
      return null;
    } finally {
      setSubmitting(false);
    }
  }

  async function createService(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await act(() => servicesApi.create({
      name: data.get("name").trim(),
      departmentId: data.get("departmentId"),
    }), "Service added.");
    if (result) {
      form.reset();
      setShowCreate(false);
    }
  }

  async function updateService(event, service) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = await act(() => servicesApi.update(service.id, {
      name: data.get("name").trim(),
      active: data.get("active") === "on",
    }), `Updated ${service.name}.`);
    if (result) setEditingId("");
  }

  return (
    <section className="content-panel admin-section" aria-labelledby="services-heading">
      <AdminSectionHeader
        id="services-heading"
        eyebrow="CLINIC OFFERINGS"
        title="Services"
        countLabel={`${services.length} configured`}
        action={<button className="button button-dark" type="button" onClick={() => setShowCreate((value) => !value)} disabled={departments.filter((item) => item.active).length === 0}>{showCreate ? "Cancel" : "Add service"}</button>}
      />
      <AdminFeedback error={error} message={message} />
      {loading && <p role="status" className="panel-description">Loading services…</p>}
      {!loading && !error && departments.filter((item) => item.active).length === 0 && <p className="panel-description">Add an active department before creating services. <Link to="/admin/departments">Go to Departments</Link></p>}
      {!loading && departments.some((item) => item.active) && services.length === 0 && <p className="panel-description">No services are configured yet. Add a service and assign it to a department.</p>}
      {showCreate && <form className="admin-inline-form" onSubmit={createService}>
        <h3>Add service</h3>
        <label htmlFor="new-service-name">Service name</label>
        <input id="new-service-name" name="name" required minLength="2" maxLength="100" />
        <label htmlFor="new-service-department">Service department</label>
        <select id="new-service-department" name="departmentId" required defaultValue="">
          <option value="" disabled>Select a department</option>
          {departments.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        {error && <p className="action-message" role="alert">{error}</p>}
        <button className="button button-dark" type="submit" disabled={submitting}>{submitting ? "Saving service…" : "Save service"}</button>
      </form>}
      <div className="admin-record-list">{services.map((service) => (
        <article className="admin-record" key={service.id}>
          <div className="admin-record-summary"><strong>{service.name}</strong><span>{departments.find((item) => item.id === service.departmentId)?.name ?? "Department unavailable"}</span><span className="enabled-label">{service.active ? "Active" : "Inactive"}</span></div>
          {editingId === service.id ? <form onSubmit={(event) => updateService(event, service)}>
            <label htmlFor={`service-name-${service.id}`}>Service name</label>
            <input id={`service-name-${service.id}`} name="name" defaultValue={service.name} required minLength="2" maxLength="100" />
            <label className="checkbox-row"><input type="checkbox" name="active" defaultChecked={service.active} /> Active</label>
            <div className="admin-form-actions"><button className="button button-dark" type="submit" disabled={submitting}>{submitting ? "Saving service…" : "Save service"}</button><button className="text-button" type="button" onClick={() => setEditingId("")}>Cancel</button></div>
          </form> : <button className="text-button" type="button" onClick={() => setEditingId(service.id)}>Edit service</button>}
        </article>
      ))}</div>
    </section>
  );
}
