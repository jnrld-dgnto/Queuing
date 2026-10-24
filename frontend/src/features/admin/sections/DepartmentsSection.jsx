import { useCallback, useEffect, useState } from "react";
import { departmentApi } from "../../../api/client.js";
import AdminFeedback from "../components/AdminFeedback.jsx";
import AdminSectionHeader from "../components/AdminSectionHeader.jsx";

export default function DepartmentsSection() {
  const [departments, setDepartments] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      setDepartments(await departmentApi.adminList(signal));
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

  async function createDepartment(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await act(() => departmentApi.create({ name: data.get("name").trim() }), "Department added.");
    if (result) {
      form.reset();
      setShowCreate(false);
    }
  }

  return (
    <section className="content-panel admin-section" aria-labelledby="departments-heading">
      <AdminSectionHeader
        id="departments-heading"
        eyebrow="QUEUE DESTINATIONS"
        title="Departments"
        countLabel={`${departments.length} configured`}
        action={<button className="button button-dark" type="button" onClick={() => setShowCreate((value) => !value)}>{showCreate ? "Cancel" : "Add department"}</button>}
      />
      <AdminFeedback error={error} message={message} />
      {loading && <p role="status" className="panel-description">Loading departments…</p>}
      {!loading && !error && departments.length === 0 && <p className="panel-description">No departments are configured yet. Add a department to define where clinic services are handled.</p>}
      {showCreate && <form className="admin-inline-form" onSubmit={createDepartment}>
        <h3>Add department</h3>
        <label htmlFor="new-department">Department name</label>
        <input id="new-department" name="name" required minLength="2" maxLength="100" />
        {error && <p className="action-message" role="alert">{error}</p>}
        <button className="button button-dark" type="submit" disabled={submitting}>{submitting ? "Saving department…" : "Save department"}</button>
      </form>}
      {departments.length > 0 && <ul className="settings-list admin-department-list">{departments.map((department) => (
        <li key={department.id}>
          <span>{department.name}</span>
          <span className="enabled-label">{department.active ? "Active" : "Inactive"}</span>
          <button className="text-button" type="button" onClick={() => {
            const active = !department.active;
            return act(() => departmentApi.update(department.id, { active }), `${department.name} ${active ? "reactivated" : "deactivated"}.`);
          }}>{department.active ? "Deactivate" : "Reactivate"}</button>
        </li>
      ))}</ul>}
    </section>
  );
}
