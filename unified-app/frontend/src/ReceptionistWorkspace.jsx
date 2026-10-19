import { useCallback, useEffect, useState } from "react";

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001"
).replace(/\/$/, "");

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "⌂" },
  { id: "patients", label: "Patients", icon: "♙" },
  { id: "doctors", label: "Doctors", icon: "✚" },
  { id: "appointments", label: "Appointments", icon: "▦" },
];

async function receptionistRequest(path, options = {}) {
  const token = sessionStorage.getItem("unifiedHealthcareToken");
  if (!token) throw new Error("Your session has expired. Please sign in again.");

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error(
      "Cannot connect to the unified backend at port 5001. Check that the backend is running."
    );
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || `Request failed with status ${response.status}`);
  }
  return result;
}

function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value).slice(0, 10)
    : date.toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function timeLabel(value) {
  if (!value) return "—";
  if (value instanceof Date) return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return String(value).slice(0, 5);
}

function StatusPill({ status }) {
  return (
    <span className={`front-status front-status-${String(status || "unknown").toLowerCase()}`}>
      {String(status || "Unknown").replace(/_/g, " ")}
    </span>
  );
}

function TableEmpty({ text }) {
  return (
    <tr>
      <td colSpan={8} className="front-table-empty">{text}</td>
    </tr>
  );
}

function FrontDeskStat({ icon, label, value, detail, tone }) {
  return (
    <article className={`front-stat-card ${tone || ""}`}>
      <div className="front-stat-top">
        <span className="front-stat-icon">{icon}</span>
        <span className="front-stat-overline">{label}</span>
      </div>
      <strong className="front-stat-value">{value ?? "—"}</strong>
      <p>{detail}</p>
    </article>
  );
}

export default function ReceptionistWorkspace({ user, onLogout }) {
  const [section, setSection] = useState("dashboard");
  const [summary, setSummary] = useState({
    registeredPatients: 0,
    activePhysicians: 0,
    totalBookings: 0,
    pendingScheduled: 0,
  });
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [doctorApplications, setDoctorApplications] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [search, setSearch] = useState("");
  const [appointmentFilter, setAppointmentFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [patientFormOpen, setPatientFormOpen] = useState(false);
  const [newPatientCredentials, setNewPatientCredentials] = useState(null);
  const [appointmentFormOpen, setAppointmentFormOpen] = useState(false);

  const [patientForm, setPatientForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    dateOfBirth: "",
    gender: "",
    bloodGroup: "",
    address: "",
    emergencyContact: "",
    allergies: "",
  });

  const [appointmentForm, setAppointmentForm] = useState({
    patientId: "",
    doctorId: "",
    appointmentDate: new Date().toISOString().slice(0, 10),
    startTime: "09:00",
    endTime: "09:30",
    reason: "",
  });

  const loadSection = useCallback(async (target = section) => {
    setLoading(true);
    setError("");

    try {
      if (target === "dashboard") {
        const result = await receptionistRequest("/api/receptionist/dashboard");
        setSummary(result.summary || {});
        setAppointments(result.recentAppointments || []);
      }

      if (target === "patients") {
        const result = await receptionistRequest("/api/receptionist/patients");
        setPatients(result.patients || []);
      }

      if (target === "doctors") {
        const [result, applicationsResult] = await Promise.all([
          receptionistRequest("/api/receptionist/doctors"),
          receptionistRequest("/api/receptionist/doctor-applications")
        ]);
        setDoctors(result.doctors || []);
        setDoctorApplications(applicationsResult.applications || []);
      }

      if (target === "appointments") {
        const [appointmentResult, patientResult, doctorResult] = await Promise.all([
          receptionistRequest(
            `/api/receptionist/appointments?status=${encodeURIComponent(appointmentFilter)}`
          ),
          receptionistRequest("/api/receptionist/patients"),
          receptionistRequest("/api/receptionist/doctors"),
        ]);

        setAppointments(appointmentResult.appointments || []);
        setPatients(patientResult.patients || []);
        setDoctors(doctorResult.doctors || []);

        setAppointmentForm((current) => ({
          ...current,
          patientId: current.patientId || String(patientResult.patients?.[0]?.patient_id || ""),
          doctorId: current.doctorId || String(doctorResult.doctors?.[0]?.doctor_id || ""),
        }));
      }
    } catch (loadError) {
      setError(loadError.message || "Unable to load this section.");
    } finally {
      setLoading(false);
    }
  }, [section, appointmentFilter]);

  useEffect(() => {
    loadSection(section);
  }, [section, appointmentFilter, loadSection]);

  function navigate(id) {
    setError("");
    setNotice("");
    setSection(id);
    if (id !== "patients") setPatientFormOpen(false);
    if (id !== "appointments") setAppointmentFormOpen(false);
  }

  async function registerPatient(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    setSaving(true);
    try {
      const result = await receptionistRequest("/api/receptionist/patients", {
        method: "POST",
        body: JSON.stringify({
          fullName: patientForm.fullName.trim(),
          email: patientForm.email.trim(),
          phone: patientForm.phone.trim(),
          dateOfBirth: patientForm.dateOfBirth || "",
          gender: patientForm.gender,
          bloodGroup: patientForm.bloodGroup,
          address: patientForm.address.trim(),
          emergencyContact: patientForm.emergencyContact.trim(),
          allergies: patientForm.allergies.trim(),
        }),
      });

      setPatientForm({
        fullName: "",
        email: "",
        phone: "",
        dateOfBirth: "",
        gender: "",
        bloodGroup: "",
        address: "",
        emergencyContact: "",
        allergies: "",
      });
      setNewPatientCredentials({
        fullName: result.patient?.full_name || patientForm.fullName,
        email: result.patient?.email || patientForm.email,
        password: result.temporaryPassword
      });      setPatientFormOpen(false);
      setSection("patients");
      setNotice(result.message || "Patient registered successfully.");
      await loadSection("patients");
    } catch (saveError) {
      setError(saveError.message || "Patient registration failed.");
    } finally {
      setSaving(false);
    }
  }

  async function scheduleAppointment(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);

    try {
      const result = await receptionistRequest("/api/receptionist/appointments", {
        method: "POST",
        body: JSON.stringify({
          patientId: Number(appointmentForm.patientId),
          doctorId: Number(appointmentForm.doctorId),
          appointmentDate: appointmentForm.appointmentDate,
          startTime: appointmentForm.startTime,
          endTime: appointmentForm.endTime,
          reason: appointmentForm.reason.trim(),
        }),
      });

      setAppointmentFormOpen(false);
      setNotice(result.message || "Appointment scheduled successfully.");
      setSection("appointments");
      setAppointmentFilter("all");
      await loadSection("appointments");
    } catch (saveError) {
      setError(saveError.message || "Appointment scheduling failed.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelAppointment(appointment) {
    if (!window.confirm(
      `Cancel the scheduled appointment for ${appointment.patient_name}?`
    )) return;

    setError("");
    setNotice("");

    try {
      const result = await receptionistRequest(
        `/api/receptionist/appointments/${appointment.appointment_id}/cancel`,
        { method: "PATCH" }
      );
      setNotice(result.message || "Appointment cancelled.");
      await loadSection(section);
    } catch (cancelError) {
      setError(cancelError.message || "Could not cancel the appointment.");
    }
  }

  async function reviewDoctorApplication(requestId, action) {
    setError("");
    setNotice("");
    try {
      const result = await receptionistRequest(
        `/api/receptionist/doctor-applications/${requestId}/${action}`,
        { method: "POST", body: JSON.stringify({}) }
      );
      setNotice(result.message || `Doctor application ${action}d.`);
      await loadSection("doctors");
    } catch (reviewError) {
      setError(reviewError.message || "Unable to process doctor application.");
    }
  }
  const filteredPatients = patients.filter((patient) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [
      patient.full_name,
      patient.email,
      patient.phone,
      String(patient.patient_id),
    ].some((value) => String(value || "").toLowerCase().includes(term));
  });

  const sectionTitle = {
    dashboard: "Dashboard",
    patients: "Patients",
    doctors: "Doctors",
    appointments: "Appointments",
  }[section];

  function renderAppointments(rows, recent = false) {
    return (
      <div className="front-table-wrap">
        <table className="front-table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Doctor</th>
              <th>Date</th>
              <th>Time</th>
              <th>Reason</th>
              <th>Status</th>
              {!recent && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((appointment) => (
              <tr key={appointment.appointment_id}>
                <td>
                  <div className="front-person-cell">
                    <span className="front-mini-avatar">
                      {(appointment.patient_name || "P").charAt(0).toUpperCase()}
                    </span>
                    <span>
                      <strong>{appointment.patient_name}</strong>
                      <small>Patient #{appointment.patient_id}</small>
                    </span>
                  </div>
                </td>
                <td>
                  <strong className="front-table-main">{appointment.doctor_name}</strong>
                  <small className="front-table-secondary">
                    {appointment.doctor_specialization || "Physician"}
                  </small>
                </td>
                <td>{dateLabel(appointment.appointment_date)}</td>
                <td>{timeLabel(appointment.start_time)}–{timeLabel(appointment.end_time)}</td>
                <td className="front-reason-cell">{appointment.reason || "—"}</td>
                <td><StatusPill status={appointment.status} /></td>
                {!recent && (
                  <td>
                    {appointment.status === "scheduled" ? (
                      <button
                        type="button"
                        className="front-text-action danger"
                        onClick={() => cancelAppointment(appointment)}
                      >
                        Cancel
                      </button>
                    ) : <span className="front-muted">—</span>}
                  </td>
                )}
              </tr>
            )) : <TableEmpty text="No appointments found for this view." />}
          </tbody>
        </table>
      </div>
    );
  }

  function renderDashboard() {
    return (
      <>
        <section className="front-hero">
          <div className="front-hero-copy">
            <span className="front-eyebrow">FRONT DESK OPERATIONS DASHBOARD</span>
            <h2>Good day, {user.fullName?.split(" ")[0] || "Team"}<span>.</span></h2>
            <p>
              Administrative coordination, patient intake, physician schedules,
              and appointment bookings in one connected workspace.
            </p>
          </div>
          <div className="front-hero-mark" aria-hidden="true">
            <span>✚</span><i /><b />
          </div>
        </section>

        <div className="front-section-heading">
          <div>
            <span className="front-eyebrow">FRONT DESK OVERVIEW</span>
            <h2>Front Desk Operations</h2>
          </div>
          <button className="front-button outline" onClick={() => loadSection("dashboard")}>
            ↻ Refresh
          </button>
        </div>

        <div className="front-stats-grid">
          <FrontDeskStat
            icon="♙"
            label="REGISTERED PATIENTS"
            value={summary.registeredPatients}
            detail="Manage demographics & intake"
            tone="patients"
          />
          <FrontDeskStat
            icon="✚"
            label="ACTIVE PHYSICIANS"
            value={summary.activePhysicians}
            detail="View specializations & contacts"
            tone="doctors"
          />
          <FrontDeskStat
            icon="▦"
            label="TOTAL BOOKINGS"
            value={summary.totalBookings}
            detail={`${summary.pendingScheduled ?? 0} pending scheduled`}
            tone="appointments"
          />
        </div>

        <section className="front-role-boundary">
          <div className="front-boundary-shield">⛨</div>
          <div className="front-boundary-copy">
            <span className="front-eyebrow">PERMISSION BOUNDARY</span>
            <h3>Administrative Only</h3>
            <p>Clinical CDS and prescription creation are restricted to authorized doctors.</p>
          </div>
          <span className="front-boundary-badge">Receptionist role</span>
        </section>

        <div className="front-action-row">
          <button
            className="front-button primary"
            onClick={() => {
              setPatientFormOpen(true);
              setAppointmentFormOpen(false);
              navigate("patients");
              setPatientFormOpen(true);
            }}
          >
            <span>＋</span> Register New Patient
          </button>
          <button
            className="front-button secondary"
            onClick={() => {
              setAppointmentFormOpen(true);
              setPatientFormOpen(false);
              navigate("appointments");
              setAppointmentFormOpen(true);
            }}
          >
            <span>＋</span> Schedule Appointment
          </button>
        </div>

        <div className="front-section-heading">
          <div>
            <span className="front-eyebrow">LATEST ACTIVITY</span>
            <h2>Recent appointments</h2>
          </div>
          <button className="front-text-action" onClick={() => navigate("appointments")}>
            View all ↗
          </button>
        </div>
        {renderAppointments(appointments, true)}
      </>
    );
  }

  function renderPatients() {
    return (
      <>
        <div className="front-page-intro">
          <div>
            <span className="front-eyebrow">PATIENT REGISTRY</span>
            <h2>Patients</h2>
            <p>Search patient accounts, review intake details, and register new patients.</p>
          </div>
          <button
            className="front-button primary"
            onClick={() => {
              setPatientFormOpen((value) => !value);
              setError("");
              setNotice("");
            }}
          >
            ＋ Register New Patient
          </button>
        </div>

        {patientFormOpen && (
          <form className="front-form-panel" onSubmit={registerPatient}>
            <div className="front-form-heading">
              <div>
                <span className="front-eyebrow">NEW PATIENT INTAKE</span>
                <h3>Register New Patient</h3>
              </div>
              <button type="button" className="front-close-button" onClick={() => setPatientFormOpen(false)}>×</button>
            </div>
            <div className="front-form-grid">
              <label>Full Name *
                <input
                  value={patientForm.fullName}
                  onChange={(e) => setPatientForm({ ...patientForm, fullName: e.target.value })}
                  maxLength={100} autoComplete="name" required
                />
              </label>
              <label>Email *
                <input
                  type="email" value={patientForm.email}
                  onChange={(e) => setPatientForm({ ...patientForm, email: e.target.value })}
                  maxLength={100} autoComplete="email" required
                />
              </label>
              <label>Phone *
                <input
                  type="tel"
                  value={patientForm.phone}
                  onChange={(e) => setPatientForm({ ...patientForm, phone: e.target.value })}
                  maxLength={20}
                  autoComplete="tel"
                  required
                />
              </label>

              <label>Date of Birth
                <input
                  type="date"
                  value={patientForm.dateOfBirth}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setPatientForm({ ...patientForm, dateOfBirth: e.target.value })}
                />
              </label>

              <label>Gender
                <select
                  value={patientForm.gender}
                  onChange={(e) => setPatientForm({ ...patientForm, gender: e.target.value })}
                >
                  <option value="">Select gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </label>

              <label>Blood Group
                <select
                  value={patientForm.bloodGroup}
                  onChange={(e) => setPatientForm({ ...patientForm, bloodGroup: e.target.value })}
                >
                  <option value="">Select blood group</option>
                  <option value="A+">A+</option>
                  <option value="A-">A-</option>
                  <option value="B+">B+</option>
                  <option value="B-">B-</option>
                  <option value="O+">O+</option>
                  <option value="O-">O-</option>
                  <option value="AB+">AB+</option>
                  <option value="AB-">AB-</option>
                </select>
              </label>

              <label>Address / City
                <textarea
                  value={patientForm.address}
                  onChange={(e) => setPatientForm({ ...patientForm, address: e.target.value })}
                  maxLength={255}
                  rows={2}
                  placeholder="Enter address or city"
                />
              </label>

              <label>Emergency Contact
                <input
                  type="text"
                  value={patientForm.emergencyContact}
                  onChange={(e) => setPatientForm({ ...patientForm, emergencyContact: e.target.value })}
                  placeholder="Name and phone number"
                />
              </label>

              <label>Recorded Allergies
                <textarea
                  value={patientForm.allergies}
                  onChange={(e) => setPatientForm({ ...patientForm, allergies: e.target.value })}
                  rows={3}
                  maxLength={2000}
                  placeholder="List known allergies, or leave blank if not recorded"
                />
              </label>
            </div>
            <p className="front-form-hint">
              Enter an initial password securely with the patient. The password is stored as a hash.
            </p>
            <div className="front-form-actions">
              <button type="button" className="front-button outline" onClick={() => setPatientFormOpen(false)}>Cancel</button>
              <button type="submit" className="front-button primary" disabled={saving}>
                {saving ? "Registering…" : "Submit Registration"}
              </button>
            </div>
          </form>
        )}

        <div className="front-list-toolbar">
          <div>
            <strong>Registered patients</strong>
            <span>{filteredPatients.length} patients shown</span>
          </div>
          <input
            aria-label="Search patients"
            placeholder="Search name, email or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="front-table-wrap">
          <table className="front-table">
            <thead>
              <tr>
                <th>Patient</th><th>Patient ID</th><th>Contact</th>
                <th>Gender</th><th>Blood group</th><th>Date of birth</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPatients.length ? filteredPatients.map((patient) => (
                <tr key={patient.patient_id}>
                  <td>
                    <div className="front-person-cell">
                      <span className="front-mini-avatar">
                        {(patient.full_name || "P").charAt(0).toUpperCase()}
                      </span>
                      <span>
                        <strong>{patient.full_name}</strong>
                        <small>{patient.email}</small>
                      </span>
                    </div>
                  </td>
                  <td>#{patient.patient_id}</td>
                  <td>{patient.phone || "—"}</td>
                  <td>{patient.gender || "—"}</td>
                  <td>{patient.blood_group || "—"}</td>
                  <td>{dateLabel(patient.date_of_birth)}</td>
                  <td><button type="button" className="patient-view-button" onClick={() => setSelectedPatient(patient)}>View</button></td>
                </tr>
              )) : <TableEmpty text="No matching patients found." />}
            </tbody>
          </table>
        </div>
        {selectedPatient && (
          <div
            className="patient-modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setSelectedPatient(null);
            }}
          >
            <section className="patient-details-modal" role="dialog" aria-modal="true" aria-labelledby="receptionist-patient-details-title">
              <div className="patient-details-header">
                <div className="patient-modal-person">
                  <span className="patient-modal-avatar">
                    {(selectedPatient.full_name || "P").charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <span className="patient-modal-kicker">PATIENT PROFILE</span>
                    <h3 id="receptionist-patient-details-title">{selectedPatient.full_name || "Patient details"}</h3>
                    <p>Patient ID #{selectedPatient.patient_id}</p>
                  </div>
                </div>
                <button type="button" className="patient-modal-close" aria-label="Close patient details" onClick={() => setSelectedPatient(null)}>X</button>
              </div>
              <div className="patient-details-grid">
                <div className="patient-details-item"><span>Email address</span><strong>{selectedPatient.email || "Not provided"}</strong></div>
                <div className="patient-details-item"><span>Phone number</span><strong>{selectedPatient.phone || "Not provided"}</strong></div>
                <div className="patient-details-item"><span>Date of birth</span><strong>{selectedPatient.date_of_birth ? dateLabel(selectedPatient.date_of_birth) : "Not provided"}</strong></div>
                <div className="patient-details-item"><span>Gender</span><strong>{selectedPatient.gender || "Not provided"}</strong></div>
                <div className="patient-details-item"><span>Blood group</span><strong>{selectedPatient.blood_group || "Not provided"}</strong></div>
                <div className="patient-details-item"><span>Allergies</span><strong>{selectedPatient.allergies || "None recorded"}</strong></div>
                <div className="patient-details-item"><span>Emergency contact</span><strong>{selectedPatient.emergency_contact || "Not provided"}</strong></div>
                <div className="patient-details-item"><span>Registration date</span><strong>{selectedPatient.created_at ? dateLabel(selectedPatient.created_at) : "Not available"}</strong></div>
                <div className="patient-details-item patient-details-full"><span>Address</span><strong>{selectedPatient.address || "Not provided"}</strong></div>
              </div>
              <div className="patient-details-footer">
                <button type="button" className="patient-modal-done" onClick={() => setSelectedPatient(null)}>Close details</button>
              </div>
            </section>
          </div>
        )}
      </>
    );
  }

  function renderDoctors() {
    return (
      <>
        <div className="front-page-intro">
          <div>
            <span className="front-eyebrow">PHYSICIAN DIRECTORY</span>
            <h2>Doctors</h2>
            <p>View registered physicians, specializations, qualifications and contact details.</p>
          </div>
          <button className="front-button outline" onClick={() => loadSection("doctors")}>↻ Refresh</button>
        </div>

        <section className="front-applications-panel">
          <div className="front-applications-heading">
            <div>
              <span className="front-eyebrow">STAFF ONBOARDING</span>
              <h3>Doctor registration applications</h3>
              <p>Review professional details before granting access to clinical records.</p>
            </div>
            <span className="front-pending-count">
              {doctorApplications.filter((item) => item.status === "pending").length} pending
            </span>
          </div>

          {doctorApplications.filter((item) => item.status === "pending").length ? (
            <div className="front-applications-list">
              {doctorApplications.filter((item) => item.status === "pending").map((application) => (
                <article className="front-application-card" key={application.request_id}>
                  <div className="front-application-avatar">
                    {(application.full_name || "D").charAt(0).toUpperCase()}
                  </div>
                  <div className="front-application-details">
                    <strong>{application.full_name}</strong>
                    <span>{application.doctor_type || "OPD"} · {application.specialization} · {application.qualification || "Qualification not provided"}</span>
                    <small>{application.email}{application.phone ? ` · ${application.phone}` : ""}</small>
                    <small>License: {application.license_number} · Experience: {application.experience_years ?? "Not provided"} years</small>
                    {application.bio && <p>{application.bio}</p>}
                    <small>Application received: {dateLabel(application.created_at)}</small>
                  </div>
                  <div className="front-application-actions">
                    <button
                      type="button"
                      className="front-button primary"
                      onClick={() => reviewDoctorApplication(application.request_id, "approve")}
                    >Approve</button>
                    <button
                      type="button"
                      className="front-button outline"
                      onClick={() => {
                        if (window.confirm(`Reject the Doctor application for ${application.full_name}?`)) {
                          reviewDoctorApplication(application.request_id, "reject");
                        }
                      }}
                    >Reject</button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="front-applications-empty">
              <strong>No pending doctor applications</strong>
              <p>New doctor applications will appear here for review.</p>
            </div>
          )}
        </section>
        <div className="front-stats-grid front-doctor-summary">
          <FrontDeskStat icon="✚" label="TOTAL DOCTORS" value={doctors.length} detail="Approved doctor accounts" tone="doctors" />
          <FrontDeskStat icon="◷" label="OPD" value={doctors.filter((doctor) => String(doctor.doctor_type || "").toLowerCase() === "opd").length} detail="Outpatient doctors" tone="doctors" />
          <FrontDeskStat icon="✚" label="SURGEONS" value={doctors.filter((doctor) => String(doctor.doctor_type || "").toLowerCase() === "surgeon").length} detail="Surgical specialists" tone="doctors" />
          <FrontDeskStat icon="♡" label="GENERAL PHYSICIANS" value={doctors.filter((doctor) => String(doctor.doctor_type || "").toLowerCase() === "general physician").length} detail="General medical care" tone="doctors" />
        </div>

        {/* DOCTOR DIRECTORY TABLE VIEW START */}
        <div className="front-page-intro front-doctor-directory-intro">
          <div>
            <span className="front-eyebrow">APPROVED MEDICAL STAFF</span>
            <h3>Doctor Directory</h3>
            <p>View doctor profiles, contact details, qualifications and experience.</p>
          </div>
          <span className="front-pending-count">{doctors.length} doctors</span>
        </div>

        <div className="front-table-wrap front-doctor-directory-table">
          <table className="front-table">
            <thead>
              <tr>
                <th>Doctor</th>
                <th>Doctor ID</th>
                <th>Category</th>
                <th>Specialization</th>
                <th>Contact</th>
                <th>Qualification</th>
                <th>Experience</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {doctors.length ? doctors.map((doctor) => (
                <tr key={doctor.doctor_id}>
                  <td>
                    <div className="front-person-cell front-doctor-table-person">
                      <span className="front-mini-avatar">
                        {(doctor.full_name || "D").charAt(0).toUpperCase()}
                      </span>
                      <span>
                        <strong>{doctor.full_name || "Doctor"}</strong>
                        <small>{doctor.status || "Active"}</small>
                      </span>
                    </div>
                  </td>
                  <td>#{doctor.doctor_id}</td>
                  <td>{doctor.doctor_type || "Other"}</td>
                  <td>{doctor.specialization || "Not provided"}</td>
                  <td>
                    <div className="front-doctor-contact">
                      <strong>{doctor.email || "No email provided"}</strong>
                      <small>{doctor.phone || "No phone provided"}</small>
                    </div>
                  </td>
                  <td>{doctor.qualification || "Not provided"}</td>
                  <td>{doctor.experience_years ?? 0} years</td>
                  <td>
                    <button
                      type="button"
                      className="front-doctor-view-button"
                      onClick={() => setSelectedDoctor(doctor)}
                    >
                      View
                    </button>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8} className="front-table-empty">
                    No approved doctors are available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selectedDoctor && (
          <div
            className="front-doctor-modal-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setSelectedDoctor(null);
            }}
          >
            <section
              className="front-doctor-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="front-doctor-modal-title"
            >
              <div className="front-doctor-modal-header">
                <div className="front-doctor-modal-identity">
                  <span className="front-doctor-modal-avatar">
                    {(selectedDoctor.full_name || "D").charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <span className="front-doctor-modal-kicker">DOCTOR PROFILE</span>
                    <h3 id="front-doctor-modal-title">{selectedDoctor.full_name || "Doctor details"}</h3>
                    <p>Doctor ID #{selectedDoctor.doctor_id}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="front-doctor-modal-close"
                  aria-label="Close doctor details"
                  onClick={() => setSelectedDoctor(null)}
                >
                  X
                </button>
              </div>

              <div className="front-doctor-modal-grid">
                <div className="front-doctor-modal-item">
                  <span>Account status</span>
                  <strong>{selectedDoctor.status || "Active"}</strong>
                </div>
                <div className="front-doctor-modal-item">
                  <span>Doctor category</span>
                  <strong>{selectedDoctor.doctor_type || "Other"}</strong>
                </div>
                <div className="front-doctor-modal-item">
                  <span>Specialization</span>
                  <strong>{selectedDoctor.specialization || "Not provided"}</strong>
                </div>
                <div className="front-doctor-modal-item">
                  <span>Email address</span>
                  <strong>{selectedDoctor.email || "Not provided"}</strong>
                </div>
                <div className="front-doctor-modal-item">
                  <span>Phone number</span>
                  <strong>{selectedDoctor.phone || "Not provided"}</strong>
                </div>
                <div className="front-doctor-modal-item">
                  <span>Qualification</span>
                  <strong>{selectedDoctor.qualification || "Not provided"}</strong>
                </div>
                <div className="front-doctor-modal-item">
                  <span>License number</span>
                  <strong>{selectedDoctor.license_number || "Not provided"}</strong>
                </div>
                <div className="front-doctor-modal-item">
                  <span>Experience</span>
                  <strong>{selectedDoctor.experience_years ?? 0} years</strong>
                </div>
                <div className="front-doctor-modal-item front-doctor-modal-full">
                  <span>Professional biography</span>
                  <strong>{selectedDoctor.bio || "No biography provided."}</strong>
                </div>
              </div>

              <div className="front-doctor-modal-footer">
                <button
                  type="button"
                  className="front-doctor-modal-done"
                  onClick={() => setSelectedDoctor(null)}
                >
                  Close details
                </button>
              </div>
            </section>
          </div>
        )}
{/* DOCTOR DIRECTORY TABLE VIEW END */}
      </>
    );
  }

  function renderAppointmentsPage() {
    return (
      <>
        <div className="front-page-intro">
          <div>
            <span className="front-eyebrow">BOOKING & SCHEDULING</span>
            <h2>Appointments</h2>
            <p>Schedule visits, review bookings, and cancel appointments that remain scheduled.</p>
          </div>
          <button
            className="front-button primary"
            onClick={() => {
              setAppointmentFormOpen((value) => !value);
              setError("");
              setNotice("");
            }}
          >
            ＋ Schedule Appointment
          </button>
        </div>

        {appointmentFormOpen && (
          <form className="front-form-panel" onSubmit={scheduleAppointment}>
            <div className="front-form-heading">
              <div>
                <span className="front-eyebrow">NEW BOOKING</span>
                <h3>Schedule an appointment</h3>
              </div>
              <button type="button" className="front-close-button" onClick={() => setAppointmentFormOpen(false)}>×</button>
            </div>

            {!patients.length || !doctors.length ? (
              <p className="front-form-hint">
                { !patients.length ? "Register a patient before scheduling. " : "" }
                { !doctors.length ? "A doctor profile is required before scheduling." : "" }
              </p>
            ) : (
              <div className="front-form-grid">
                <label>Patient
                  <select value={appointmentForm.patientId} onChange={(e) => setAppointmentForm({ ...appointmentForm, patientId: e.target.value })} required>
                    <option value="">Select patient…</option>
                    {patients.map((patient) => (
                      <option key={patient.patient_id} value={patient.patient_id}>
                        {patient.full_name} · #{patient.patient_id}
                      </option>
                    ))}
                  </select>
                </label>
                <label>Doctor
                  <select value={appointmentForm.doctorId} onChange={(e) => setAppointmentForm({ ...appointmentForm, doctorId: e.target.value })} required>
                    <option value="">Select doctor…</option>
                    {doctors.map((doctor) => (
                      <option key={doctor.doctor_id} value={doctor.doctor_id}>
                        {doctor.full_name}{doctor.specialization ? ` · ${doctor.specialization}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>Appointment date
                  <input
                    type="date"
                    min={new Date().toISOString().slice(0, 10)}
                    value={appointmentForm.appointmentDate}
                    onChange={(e) => setAppointmentForm({ ...appointmentForm, appointmentDate: e.target.value })}
                    required
                  />
                </label>
                <label>Start time
                  <input type="time" value={appointmentForm.startTime} onChange={(e) => setAppointmentForm({ ...appointmentForm, startTime: e.target.value })} required />
                </label>
                <label>End time
                  <input type="time" value={appointmentForm.endTime} onChange={(e) => setAppointmentForm({ ...appointmentForm, endTime: e.target.value })} required />
                </label>
                <label>Reason for visit
                  <input
                    value={appointmentForm.reason}
                    onChange={(e) => setAppointmentForm({ ...appointmentForm, reason: e.target.value })}
                    maxLength={500}
                    placeholder="e.g. Follow-up appointment"
                  />
                </label>
              </div>
            )}

            <p className="front-form-hint">
              The system checks overlapping scheduled appointments for the selected patient and doctor.
            </p>
            <div className="front-form-actions">
              <button type="button" className="front-button outline" onClick={() => setAppointmentFormOpen(false)}>Cancel</button>
              <button type="submit" className="front-button primary" disabled={saving || !patients.length || !doctors.length}>
                {saving ? "Scheduling…" : "Confirm appointment"}
              </button>
            </div>
          </form>
        )}

        <div className="front-list-toolbar">
          <div><strong>Appointment register</strong><span>{appointments.length} bookings shown</span></div>
          <select aria-label="Filter by appointment status" value={appointmentFilter} onChange={(e) => setAppointmentFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {renderAppointments(appointments)}
      </>
    );
  }

  return (
    <div className="front-desk-layout">
      <aside className="front-sidebar">
        <a className="front-brand" href="#" onClick={(event) => { event.preventDefault(); navigate("dashboard"); }}>
          <span className="front-brand-mark">✚</span>
          <span><strong>HealthCare</strong><small>FRONT DESK</small></span>
        </a>

        <div className="front-sidebar-label">Front Desk</div>
        <nav className="front-nav" aria-label="Receptionist navigation">
          {NAV_ITEMS.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => navigate(item.id)}
              className={`front-nav-item ${section === item.id ? "active" : ""}`}
              aria-current={section === item.id ? "page" : undefined}
            >
              <span className="front-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              {section === item.id && <i />}
            </button>
          ))}
        </nav>

        <div className="front-sidebar-bottom">
          <div className="front-sidebar-user">
            <div className="front-user-avatar">
              {(user.fullName || "R").trim().charAt(0).toUpperCase()}
            </div>
            <div className="front-user-copy">
              <strong>{user.fullName || "Receptionist"}</strong>
              <span>Receptionist Staff</span>
            </div>
          </div>
          <button type="button" className="front-signout" onClick={onLogout}>
            <span>↪</span> Sign Out
          </button>
          <small className="front-sidebar-caption">Healthcare · Administrative portal</small>
        </div>
      </aside>

      <main className="front-main">
        <header className="front-topbar">
          <div>
            <div className="front-breadcrumb">Healthcare <span>/</span> Front Desk <span>/</span> {sectionTitle}</div>
            <h1>{sectionTitle}</h1>
          </div>
          <div className="front-topbar-user">
            <span className="front-staff-label"><strong>{user.fullName || "Staff"}</strong><small>Front Desk Staff</small></span>
            <div className="front-user-avatar">{(user.fullName || "R").trim().charAt(0).toUpperCase()}</div>
          </div>
        </header>

        <div className="front-content">
          {notice && (
            <div className="front-notice" role="status">
              <span>✓</span><p>{notice}</p>
              <button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}>×</button>
            </div>
          )}
          {newPatientCredentials?.password && (
            <section className="front-credential-panel" role="status">
              <div className="front-credential-header">
                <div>
                  <span className="front-eyebrow">PATIENT ACCESS</span>
                  <h3>Patient registered successfully</h3>
                  <p>
                    Share this generated initial password privately with the patient.
                    It will not be shown again after you dismiss this panel or reload the page.
                  </p>
                </div>
                <button
                  type="button"
                  className="front-close-button"
                  aria-label="Hide generated password"
                  onClick={() => setNewPatientCredentials(null)}
                >
                  ×
                </button>
              </div>
              <div className="front-credential-account">
                <span>Patient</span>
                <strong>{newPatientCredentials.fullName}</strong>
                <span>Email</span>
                <strong>{newPatientCredentials.email}</strong>
              </div>
              <div className="front-credential-value">
                <code>{newPatientCredentials.password}</code>
                <button
                  type="button"
                  className="front-button primary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(newPatientCredentials.password);
                      setNotice("Initial password copied. Share it privately with the patient.");
                    } catch {
                      setError("Clipboard access failed. Carefully share the displayed password through a secure channel.");
                    }
                  }}
                >
                  Copy password
                </button>
              </div>
              <p className="front-credential-warning">
                Treat this password as a secret. Do not send it in an ordinary group chat or leave it displayed at the front desk.
              </p>
            </section>
          )}          {error && (
            <div className="front-error" role="alert">
              <strong>Something needs attention</strong><p>{error}</p>
              <button type="button" onClick={() => { setError(""); loadSection(section); }}>Retry</button>
            </div>
          )}
          {loading && <div className="front-loading"><span /> Loading live database information…</div>}

          {!error && section === "dashboard" && renderDashboard()}
          {!error && section === "patients" && renderPatients()}
          {!error && section === "doctors" && renderDoctors()}
          {!error && section === "appointments" && renderAppointmentsPage()}
        </div>

        <footer className="front-footer">
          <span>HealthCare <i>•</i> Front Desk</span>
          <span>Unified API · Port 5001 · Administrative access only</span>
        </footer>
      </main>
    </div>
  );
}





