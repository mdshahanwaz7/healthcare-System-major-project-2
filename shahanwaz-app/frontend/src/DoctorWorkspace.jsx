import { useEffect, useRef, useState } from "react";
import HealthcareProfileIcon from "./HealthcareProfileIcon";
import "./clinical-chat.css";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5001").replace(/\/$/, "");

const DOCTOR_NAV = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "patients", label: "My Patients", icon: "♙" },
  { id: "appointments", label: "Appointments", icon: "▦" },
  { id: "prescriptions", label: "Prescriptions", icon: "✚" },
  { id: "schedule", label: "My Schedule", icon: "◷" },
  { id: "care", label: "Discharge Care", icon: "♡" },
  { id: "assistant", label: "Clinical Assistant", icon: "✧" },
  { id: "ocr", label: "Prescription OCR", icon: "▧" },
  { id: "profile", label: "My Profile", icon: "profile" },
];

async function doctorRequest(path, options = {}) {
  const token = sessionStorage.getItem("unifiedHealthcareToken");
  if (!token) throw new Error("Your session has expired. Please sign in again.");

  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error("Cannot connect to the unified backend at port 5001.");
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || `Request failed (${response.status}).`);
  return result;
}

function friendlyKey(key) {
  return String(key).replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function valueText(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "object") return Array.isArray(value) ? value.map(valueText).join(", ") : JSON.stringify(value);
  return String(value);
}

function dateText(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10)
    : date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function timeText(value) {
  return value ? String(value).slice(0, 5) : "—";
}

function DoctorEmpty({ symbol = "▧", title, detail }) {
  return (
    <div className="doc-empty">
      <span>{symbol}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function DoctorStat({ label, value, icon, detail, onClick }) {
  return (
    <article
      className={`doc-stat ${onClick ? "doc-stat--interactive" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      } : undefined}
    >
      <div className="doc-stat-header">
        <span>{label}</span><i>{icon}</i>
      </div>
      <strong>{value ?? "—"}</strong>
      <p>{detail}</p>
    </article>
  );
}

/* DOCTOR RECORDS TABLE WITH VIEW DETAILS */
function RecordCards({ items, kind, emptyTitle, emptyDetail }) {
  const [selectedRecord, setSelectedRecord] = useState(null);

  useEffect(() => {
    if (!selectedRecord) return undefined;
    function handleEscape(event) {
      if (event.key === "Escape") setSelectedRecord(null);
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectedRecord]);

  if (!items?.length) return <DoctorEmpty title={emptyTitle} detail={emptyDetail} />;

  const recordId = (item) => kind === "Prescription"
    ? item.prescription_id ?? item.id ?? "—"
    : item.discharge_id ?? item.id ?? "—";
  const patientLabel = (item) => item.patient_name || item.full_name ||
    (item.patient_id ? `Patient #${item.patient_id}` : item.patient_email || "—");
  const recordDate = (item) => item.prescription_date || item.discharge_date ||
    item.created_at || item.createdAt || item.updated_at || null;
  const medicinesFor = (record) => {
    const raw = record?.medicines;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
      } catch {
        return [];
      }
    }
    return raw && typeof raw === "object" ? [raw] : [];
  };
  const visibleFields = selectedRecord
    ? Object.entries(selectedRecord).filter(([key, value]) =>
        key !== "medicines" &&
        !/password|token|secret|file_path|binary_data|blob_data/i.test(key) &&
        value !== null && value !== undefined && value !== ""
      )
    : [];
  const detailValue = (key, value) => {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "string" && /date|_at|timestamp/i.test(key)) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleString();
    }
    return valueText(value);
  };

  return (
    <>
      <div className="doc-record-table-wrap">
        <table className="doc-table doc-record-table">
          <thead>
            <tr>
              <th>Record ID</th>
              <th>Patient</th>
              <th>Date</th>
              <th>Diagnosis</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.prescription_id || item.discharge_id || item.job_id || item.id || index}>
                <td>#{recordId(item)}</td>
                <td>
                  <div className="doc-record-table-patient">
                    <strong>{patientLabel(item)}</strong>
                    {item.patient_email && <small>{item.patient_email}</small>}
                  </div>
                </td>
                <td>{dateText(recordDate(item))}</td>
                <td className="doc-record-table-diagnosis">{item.diagnosis || item.title || "—"}</td>
                <td><span className="doc-status-pill">{item.status || (kind === "Prescription" ? "Recorded" : "Discharged")}</span></td>
                <td>
                  <button
                    type="button"
                    className="doc-record-view-button"
                    onClick={() => setSelectedRecord(item)}
                    aria-label={`View ${kind} record ${recordId(item)}`}
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedRecord && (
        <div
          className="doc-record-detail-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedRecord(null);
          }}
        >
          <section
            className="doc-record-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="doc-record-detail-title"
          >
            <header className="doc-record-detail-header">
              <div className="doc-record-detail-heading">
                <div>
                  
                  <h2 id="doc-record-detail-title">{patientLabel(selectedRecord)}</h2>
</div>
              </div>
              <button
                type="button"
                className="doc-record-detail-close"
                onClick={() => setSelectedRecord(null)}
                aria-label="Close record details"
              >
                ×
              </button>
            </header>

            <div className="doc-record-detail-content">
              <h3>Record details</h3>
              <dl className="doc-record-detail-grid">
                {visibleFields.map(([key, value]) => (
                  <div key={key} className={/instructions|warning|diagnosis|summary|notes|allerg/i.test(key) ? "doc-record-detail-field is-long" : "doc-record-detail-field"}>
                    <dt>{friendlyKey(key)}</dt>
                    <dd>{detailValue(key, value)}</dd>
                  </div>
                ))}
              </dl>

              {medicinesFor(selectedRecord).length > 0 && (
                <section className="doc-record-detail-medicines">
                  <h3>Medicines</h3>
                  <div className="doc-record-medicine-table-wrap">
                    <table className="doc-record-medicine-table">
                      <thead>
                        <tr><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Route</th><th>Instructions</th></tr>
                      </thead>
                      <tbody>
                        {medicinesFor(selectedRecord).map((medicine, index) => (
                          <tr key={medicine.medicine_id || index}>
                            <td>{medicine.medicine_name || medicine.medication_name || medicine.name || "Medicine"}</td>
                            <td>{valueText(medicine.dosage || medicine.dose)}</td>
                            <td>{valueText(medicine.frequency)}</td>
                            <td>{valueText(medicine.duration)}</td>
                            <td>{valueText(medicine.route)}</td>
                            <td>{valueText(medicine.instructions)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>

            <footer className="doc-record-detail-footer">
              <button type="button" className="doc-outline-button" onClick={() => setSelectedRecord(null)}>
                Back to records
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
export default function DoctorWorkspace({ user, onLogout, onUserUpdate }) {
  const [section, setSection] = useState("overview");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [overview, setOverview] = useState(null);
  const [patients, setPatients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [scheduleOptions, setScheduleOptions] = useState({ days: [], activityTypes: [] });
  const [discharges, setDischarges] = useState([]);
  const [ocrJobs, setOcrJobs] = useState([]);
  const [appointmentFilter, setAppointmentFilter] = useState("all");
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [profileForm, setProfileForm] = useState({
    fullName: user.fullName || "",
    phone: user.phone || "",
    specialization: "",
    qualification: "",
    licenseNumber: "",
    experienceYears: "",
    bio: "",
    email: user.email || "",
  });
  const [credentialForm, setCredentialForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: "",
  });  const [scheduleForm, setScheduleForm] = useState({
    dayOfWeek: "",
    startTime: "09:00",
    endTime: "17:00",
    activityType: "",
    location: "",
    notes: "",
    available: true,
  });
  const [prescriptionForm, setPrescriptionForm] = useState({
    patientId: "", diagnosis: "", notes: "",
  });
  const [medicines, setMedicines] = useState([
    { name: "", dosage: "", frequency: "", duration: "", quantity: "", route: "", instructions: "" }
  ]);
  const [dischargeForm, setDischargeForm] = useState({
    patientId: "", diagnosis: "", treatmentSummary: "", instructions: "", warningSigns: "",
    medications: "", dischargeDate: new Date().toISOString().slice(0, 10), followUpDate: "",
  });
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantMessages, setAssistantMessages] = useState([]);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const assistantChatEndRef = useRef(null);

  useEffect(() => {
    assistantChatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [assistantMessages, assistantLoading]);
  const [ocrPatientId, setOcrPatientId] = useState("");
  const [ocrFile, setOcrFile] = useState(null);

  async function loadSection(target = section) {
    setBusy(true);
    setError("");

    try {
      if (["appointments", "patients", "prescriptions", "care", "ocr"].includes(target)) {
        const patientResult = await doctorRequest("/api/doctor/patients");
        const patientRows = patientResult.patients || [];
        setPatients(patientRows);
        if (patientRows.length) {
          setPrescriptionForm((current) => ({ ...current, patientId: current.patientId || String(patientRows[0].patient_id) }));
          setDischargeForm((current) => ({ ...current, patientId: current.patientId || String(patientRows[0].patient_id) }));
          setOcrPatientId((current) => current || String(patientRows[0].patient_id));
        }
      }

      if (target === "overview") {
        const result = await doctorRequest("/api/doctor/overview");
        setOverview(result);
        setProfileForm((current) => ({
          ...current,
          ...(result.doctor || {}),
          fullName: result.doctor?.full_name || user.fullName || "",
          phone: result.doctor?.phone || user.phone || "",
          email: result.doctor?.email || user.email || "",
          licenseNumber: result.doctor?.license_number || "",
          experienceYears: result.doctor?.experience_years ?? "",
        }));
      }

      if (target === "patients") {
        const result = await doctorRequest("/api/doctor/patients");
        setPatients(result.patients || []);
      }

      if (target === "appointments") {
        const result = await doctorRequest(`/api/doctor/appointments?status=${appointmentFilter}`);
        setAppointments(result.appointments || []);
      }

      if (target === "prescriptions") {
        const result = await doctorRequest("/api/doctor/prescriptions");
        setPrescriptions(result.prescriptions || []);
      }

      if (target === "schedule") {
        const [scheduleResult, optionsResult] = await Promise.all([
          doctorRequest("/api/doctor/schedule"),
          doctorRequest("/api/doctor/schedule/options"),
        ]);
        setSchedule(scheduleResult.schedule || []);
        setScheduleOptions(optionsResult);
        setScheduleForm((current) => ({
          ...current,
          dayOfWeek: current.dayOfWeek !== "" ? current.dayOfWeek : optionsResult.days?.[0]?.value ?? "",
          activityType: current.activityType || optionsResult.activityTypes?.[0] || "",
        }));
      }

      if (target === "care") {
        const result = await doctorRequest("/api/doctor/discharge-care");
        setDischarges(result.discharges || []);
      }

      if (target === "profile") {
        const result = await doctorRequest("/api/doctor/profile");
        const doctor = result.profile || {};
        setProfileForm((current) => ({
          ...current,
          fullName: doctor.full_name || user.fullName || "",
          phone: doctor.phone || user.phone || "",
          specialization: doctor.specialization || "",
          qualification: doctor.qualification || "",
          licenseNumber: doctor.license_number || "",
          experienceYears: doctor.experience_years ?? "",
          bio: doctor.bio || "",
          email: doctor.email || user.email || "",
        }));
      }

      if (target === "ocr") {
        const result = await doctorRequest("/api/doctor/ocr");
        setOcrJobs(result.jobs || []);
      }
    } catch (loadError) {
      setError(loadError.message || "Unable to load this workspace section.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadSection(section);
  }, [section, appointmentFilter]);

  function goTo(id) {
    setError("");
    setNotice("");
    setSection(id);
  }

  async function updateAppointment(appointmentId, status) {
    setError("");
    setNotice("");
    try {
      const result = await doctorRequest(`/api/doctor/appointments/${appointmentId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setNotice(result.message);
      await loadSection("appointments");
    } catch (updateError) {
      setError(updateError.message || "Unable to update this appointment.");
    }
  }

  async function saveSchedule(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await doctorRequest("/api/doctor/schedule", {
        method: "POST",
        body: JSON.stringify(scheduleForm),
      });
      setNotice(result.message);
      await loadSection("schedule");
    } catch (saveError) {
      setError(saveError.message || "Unable to save the schedule.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleSchedule(entry) {
    const id = entry.scheduleId ?? entry.schedule_id ?? entry.id;
    if (!id) {
      setError("Schedule entry ID is missing in the returned database record.");
      return;
    }
    try {
      await doctorRequest(`/api/doctor/schedule/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ available: !(entry.available === true || Number(entry.available) === 1) }),
      });
      await loadSection("schedule");
    } catch (updateError) {
      setError(updateError.message || "Unable to change availability.");
    }
  }

  async function deleteSchedule(entry) {
    const id = entry.scheduleId ?? entry.schedule_id ?? entry.id;
    if (!id || !window.confirm("Delete this schedule entry?")) return;
    try {
      const result = await doctorRequest(`/api/doctor/schedule/${id}`, { method: "DELETE" });
      setNotice(result.message);
      await loadSection("schedule");
    } catch (deleteError) {
      setError(deleteError.message || "Unable to delete the schedule entry.");
    }
  }

  async function savePrescription(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");

    const submittedMedicines = medicines
      .filter((medicine) => medicine.name.trim())
      .map((medicine) => ({
        ...medicine,
        name: medicine.name.trim(),
        quantity: medicine.quantity === "" ? undefined : Number(medicine.quantity),
      }));

    try {
      const result = await doctorRequest("/api/doctor/prescriptions", {
        method: "POST",
        body: JSON.stringify({
          ...prescriptionForm,
          patientId: Number(prescriptionForm.patientId),
          medicines: submittedMedicines,
        }),
      });
      setNotice(result.message);
      setPrescriptionForm((current) => ({ ...current, diagnosis: "", notes: "" }));
      setMedicines([{ name: "", dosage: "", frequency: "", duration: "", quantity: "", route: "", instructions: "" }]);
      await loadSection("prescriptions");
    } catch (saveError) {
      setError(saveError.message || "Unable to save this prescription.");
    } finally {
      setSaving(false);
    }
  }

  async function saveDischargeCare(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await doctorRequest("/api/doctor/discharge-care", {
        method: "POST",
        body: JSON.stringify({
          ...dischargeForm,
          patientId: Number(dischargeForm.patientId),
        }),
      });
      setNotice(result.message);
      setDischargeForm((current) => ({
        ...current, diagnosis: "", treatmentSummary: "", instructions: "", warningSigns: "",
        medications: "", followUpDate: "",
      }));
      await loadSection("care");
    } catch (saveError) {
      setError(saveError.message || "Unable to save the discharge record.");
    } finally {
      setSaving(false);
    }
  }

  async function askClinicalAssistant(event) {
    event.preventDefault();
    const question = assistantQuestion.trim();
    if (!question || assistantLoading) return;

    const messageTime = Date.now();
    setAssistantQuestion("");
    setAssistantLoading(true);
    setAssistantMessages((previous) => [
      ...previous,
      { id: `user-${messageTime}`, role: "user", content: question }
    ]);

    try {
      const result = await doctorRequest("/api/doctor/clinical-assistant", {
        method: "POST",
        body: JSON.stringify({ question }),
      });

      if (typeof result.answer !== "string" || !result.answer.trim()) {
        throw new Error("The assistant did not return a readable text answer.");
      }

      setAssistantMessages((previous) => [
        ...previous,
        {
          id: `assistant-${messageTime}`,
          role: "assistant",
          content: result.answer.trim(),
          sources: Array.isArray(result.sources) ? result.sources : [],
          disclaimer: result.disclaimer || ""
        }
      ]);
    } catch (requestError) {
      setAssistantMessages((previous) => [
        ...previous,
        {
          id: `error-${messageTime}`,
          role: "error",
          content: requestError.message || "Clinical assistant request failed."
        }
      ]);
    } finally {
      setAssistantLoading(false);
    }
  }

  async function uploadPrescription(event) {
    event.preventDefault();
    if (!ocrFile || !ocrPatientId) {
      setError("Select a linked patient and a prescription file.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const body = new FormData();
      body.append("patientId", ocrPatientId);
      body.append("file", ocrFile);
      const result = await doctorRequest("/api/doctor/ocr", {
        method: "POST",
        body,
      });
      setNotice(result.message || "OCR job recorded.");
      setOcrFile(null);
      event.currentTarget.reset();
      await loadSection("ocr");
    } catch (uploadError) {
      setError(uploadError.message || "Unable to upload the prescription.");
    } finally {
      setSaving(false);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");

    const email = profileForm.email.trim().toLowerCase();
    const currentEmail = String(user.email || "").trim().toLowerCase();
    const emailChanged = email !== currentEmail;
    const passwordChangeRequested = credentialForm.newPassword.length > 0;

    if (passwordChangeRequested && credentialForm.newPassword !== credentialForm.confirmNewPassword) {
      setSaving(false);
      setError("The new password and confirmation do not match.");
      return;
    }
    if ((emailChanged || passwordChangeRequested) && !credentialForm.currentPassword) {
      setSaving(false);
      setError("Enter your current password to change your sign-in email or password.");
      return;
    }

    try {
      const result = await doctorRequest("/api/doctor/profile", {
        method: "PUT",
        body: JSON.stringify({
          fullName: profileForm.fullName,
          email,
          phone: profileForm.phone,
          specialization: profileForm.specialization,
          qualification: profileForm.qualification,
          licenseNumber: profileForm.licenseNumber,
          experienceYears: profileForm.experienceYears,
          bio: profileForm.bio,
          currentPassword: credentialForm.currentPassword,
          newPassword: credentialForm.newPassword,
        }),
      });
      if (result.user && onUserUpdate) onUserUpdate(result.user);
      setCredentialForm({ currentPassword: "", newPassword: "", confirmNewPassword: "" });
      setNotice(result.message || "Profile and account updated successfully.");
      await loadSection("profile");
    } catch (saveError) {
      setError(saveError.message || "Unable to update your profile.");
    } finally {
      setSaving(false);
    }
  }  const activeItem = DOCTOR_NAV.find((item) => item.id === section);
  const filteredPatients = patients.filter((patient) => {
    const term = patientSearch.trim().toLowerCase();
    if (!term) return true;
    return [patient.full_name, patient.email, patient.phone, patient.patient_id]
      .some((value) => String(value || "").toLowerCase().includes(term));
  });

  function renderOverview() {
    const summary = overview?.summary || {};
    return (
      <>
        <section className="doc-hero">
          <div>
            <span className="doc-eyebrow">CLINICAL WORKSPACE</span>
            <h2>Welcome, Dr. {user.fullName?.replace(/^Dr\.?\s*/i, "") || "Doctor"}<span>.</span></h2>
            <p>Your patient care, appointments, prescriptions and recovery planning in one secure workspace.</p>
            {overview?.doctor?.specialization && <span className="doc-specialty-chip">{overview.doctor.specialization}</span>}
          </div>
          <div className="doc-hero-symbol" aria-hidden="true">✚</div>
        </section>

        <div className="doc-section-heading">
          <div><span className="doc-eyebrow">YOUR PRACTICE</span><h2>Overview</h2></div>
          <button className="doc-outline-button" onClick={() => loadSection("overview")}>↻ Refresh</button>
        </div>

        <div className="doc-stats-grid">
          <DoctorStat icon="♙" label="MY PATIENTS" value={summary.patients ?? "—"} detail="Patients linked to your care" onClick={() => goTo("patients")} />
          <DoctorStat icon="▦" label="APPOINTMENTS" value={summary.appointments ?? "—"} detail={`${summary.scheduledAppointments ?? 0} currently scheduled`} onClick={() => goTo("appointments")} />
          <DoctorStat icon="✚" label="PRESCRIPTIONS" value={summary.prescriptions ?? "—"} detail="Your recorded prescriptions" onClick={() => goTo("prescriptions")} />
          <DoctorStat icon="♡" label="DISCHARGE CARE" value={summary.discharges ?? "—"} detail="Your discharge records" onClick={() => goTo("care")} />
        </div>

        <div className="doc-section-heading">
          <div><span className="doc-eyebrow">UP NEXT</span><h2>Upcoming appointments</h2></div>
          <button className="doc-text-button" onClick={() => goTo("appointments")}>View appointments ↗</button>
        </div>

        {overview?.upcomingAppointments?.length ? (
          <div className="doc-upcoming-list">
            {overview.upcomingAppointments.map((appointment) => (
              <article className="doc-upcoming-card" key={appointment.appointment_id}>
                <div className="doc-calendar-mark">
                  <strong>{new Date(appointment.appointment_date).getDate()}</strong>
                  <span>{new Date(appointment.appointment_date).toLocaleString(undefined, { month: "short" })}</span>
                </div>
                <div className="doc-upcoming-details">
                  <strong>{appointment.patient_name}</strong>
                  <span>{timeText(appointment.start_time)}–{timeText(appointment.end_time)} · {appointment.reason || "Appointment"}</span>
                </div>
                <span className="doc-status-pill scheduled">Scheduled</span>
              </article>
            ))}
          </div>
        ) : (
          <DoctorEmpty title="No upcoming appointments" detail="Scheduled appointments assigned to you will appear here." />
        )}

        <div className="doc-quick-grid">
          {DOCTOR_NAV.filter((item) => ["patients", "prescriptions", "schedule", "care", "assistant", "ocr"].includes(item.id)).map((item) => (
            <button type="button" className="doc-quick-card" key={item.id} onClick={() => goTo(item.id)}>
              <span>{item.icon}</span><strong>{item.label}</strong><i>↗</i>
            </button>
          ))}
        </div>
      </>
    );
  }

  function renderPatients() {
    return (
      <>
        <div className="doc-page-intro">
          <div><span className="doc-eyebrow">CONTINUITY OF CARE</span><h2>My Patients</h2><p>Patients linked to your appointments, discharge records or prescriptions.</p></div>
          <span className="doc-count-chip">{filteredPatients.length} patients</span>
        </div>
        <div className="doc-table-toolbar">
          <strong>Patient directory</strong>
          <input placeholder="Search name, email or patient ID…" value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} />
        </div>
        <div className="doc-table-wrap">
          <table className="doc-table">
            <thead><tr><th>Patient</th><th>Patient ID</th><th>Phone</th><th>Blood group</th><th>Date of birth</th><th>Allergies</th><th>Actions</th></tr></thead>
            <tbody>
              {filteredPatients.map((patient) => (
                <tr key={patient.patient_id}>
                  <td><div className="doc-person"><span>{(patient.full_name || "P").charAt(0).toUpperCase()}</span><div><strong>{patient.full_name}</strong><small>{patient.email}</small></div></div></td>
                  <td>#{patient.patient_id}</td>
                  <td>{patient.phone || "—"}</td>
                  <td>{patient.blood_group || "—"}</td>
                  <td>{dateText(patient.date_of_birth)}</td>
                  <td className="doc-allergy-cell">{patient.allergies || "None recorded"}</td>
                  <td><button type="button" className="patient-view-button" onClick={() => setSelectedPatient(patient)}>View</button></td>
                </tr>
              ))}
              {!filteredPatients.length && <tr><td colSpan={7}><DoctorEmpty title="No linked patients" detail="Patients linked to your appointments or clinical records will appear here." /></td></tr>}
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
            <section className="patient-details-modal" role="dialog" aria-modal="true" aria-labelledby="doctor-patient-details-title">
              <div className="patient-details-header">
                <div className="patient-modal-person">
                  <span className="patient-modal-avatar">
                    {(selectedPatient.full_name || "P").charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <span className="patient-modal-kicker">PATIENT PROFILE</span>
                    <h3 id="doctor-patient-details-title">{selectedPatient.full_name || "Patient details"}</h3>
                    <p>Patient ID #{selectedPatient.patient_id}</p>
                  </div>
                </div>
                <button type="button" className="patient-modal-close" aria-label="Close patient details" onClick={() => setSelectedPatient(null)}>X</button>
              </div>
              <div className="patient-details-grid">
                <div className="patient-details-item"><span>Email address</span><strong>{selectedPatient.email || "Not provided"}</strong></div>
                <div className="patient-details-item"><span>Phone number</span><strong>{selectedPatient.phone || "Not provided"}</strong></div>
                <div className="patient-details-item"><span>Date of birth</span><strong>{selectedPatient.date_of_birth ? dateText(selectedPatient.date_of_birth) : "Not provided"}</strong></div>
                <div className="patient-details-item"><span>Gender</span><strong>{selectedPatient.gender || "Not provided"}</strong></div>
                <div className="patient-details-item"><span>Blood group</span><strong>{selectedPatient.blood_group || "Not provided"}</strong></div>
                <div className="patient-details-item"><span>Allergies</span><strong>{selectedPatient.allergies || "None recorded"}</strong></div>
                <div className="patient-details-item"><span>Emergency contact</span><strong>{selectedPatient.emergency_contact || "Not provided"}</strong></div>
                <div className="patient-details-item patient-details-full"><span>Address</span><strong>{selectedPatient.address || "Not provided"}</strong></div>
              </div>
              <div className="patient-details-footer">
                <button type="button" className="doc-outline-button" onClick={() => { setPrescriptionForm((current) => ({ ...current, patientId: String(selectedPatient.patient_id) })); setSelectedPatient(null); goTo("prescriptions"); }}>Create prescription for this patient</button>
                <button type="button" className="doc-outline-button" onClick={() => { setDischargeForm((current) => ({ ...current, patientId: String(selectedPatient.patient_id) })); setSelectedPatient(null); goTo("care"); }}>Start discharge record</button>
                <button type="button" className="patient-modal-done" onClick={() => setSelectedPatient(null)}>Close details</button>
              </div>
            </section>
          </div>
        )}
      </>
    );
  }

  function renderAppointments() {
    return (
      <>
        <div className="doc-page-intro"><div><span className="doc-eyebrow">VISITS & FOLLOW-UP</span><h2>Appointments</h2><p>View and update appointments assigned to your doctor profile.</p></div></div>
        <div className="doc-table-toolbar">
          <strong>Appointment register</strong>
          <select value={appointmentFilter} onChange={(event) => setAppointmentFilter(event.target.value)}>
            <option value="all">All statuses</option><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="doc-table-wrap">
          <table className="doc-table">
            <thead><tr><th>Patient</th><th>Date</th><th>Time</th><th>Reason</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {appointments.map((appointment) => (
                <tr key={appointment.appointment_id}>
                  <td><div className="doc-person"><span>{(appointment.patient_name || "P").charAt(0).toUpperCase()}</span><div><strong>{appointment.patient_name}</strong><small>{appointment.patient_email}</small></div></div></td>
                  <td>{dateText(appointment.appointment_date)}</td>
                  <td>{timeText(appointment.start_time)}–{timeText(appointment.end_time)}</td>
                  <td>{appointment.reason || "—"}</td>
                  <td><span className={`doc-status-pill ${appointment.status}`}>{appointment.status}</span></td>
                  <td>
                    {appointment.status === "scheduled" ? (
                      <div className="doc-row-actions">
                        <button onClick={() => updateAppointment(appointment.appointment_id, "completed")}>Complete</button>
                        <button className="danger" onClick={() => updateAppointment(appointment.appointment_id, "cancelled")}>Cancel</button>
                      </div>
                    ) : "—"}
                  </td>
                </tr>
              ))}
              {!appointments.length && <tr><td colSpan={6}><DoctorEmpty title="No appointments found" detail="Appointments assigned to you will appear here." /></td></tr>}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  function renderPrescriptions() {
    return (
      <>
        <div className="doc-page-intro"><div><span className="doc-eyebrow">MEDICATION MANAGEMENT</span><h2>Prescriptions</h2><p>Create and review prescriptions for patients linked to your care.</p></div></div>
        <form className="doc-form-panel" onSubmit={savePrescription}>
          <div className="doc-form-title"><div><span className="doc-eyebrow">NEW CLINICAL RECORD</span><h3>Create prescription</h3></div></div>
          <div className="doc-form-grid">
            <label>Patient *
              <select required value={prescriptionForm.patientId} onChange={(e) => setPrescriptionForm({ ...prescriptionForm, patientId: e.target.value })}>
                <option value="">Choose linked patient</option>
                {patients.map((patient) => <option key={patient.patient_id} value={patient.patient_id}>{patient.full_name} · #{patient.patient_id}</option>)}
              </select>
            </label>
            <label className="full">Diagnosis / reason *
              <textarea rows={2} maxLength={3000} required value={prescriptionForm.diagnosis} onChange={(e) => setPrescriptionForm({ ...prescriptionForm, diagnosis: e.target.value })} />
            </label>
            <label className="full">Clinical notes
              <textarea rows={2} maxLength={5000} value={prescriptionForm.notes} onChange={(e) => setPrescriptionForm({ ...prescriptionForm, notes: e.target.value })} />
            </label>
          </div>

          <div className="doc-medicine-form-heading"><strong>Medicines</strong><button type="button" onClick={() => setMedicines([...medicines, { name: "", dosage: "", frequency: "", duration: "", quantity: "", route: "", instructions: "" }])}>＋ Add medicine</button></div>
          {medicines.map((medicine, index) => (
            <div className="doc-medicine-form-row" key={index}>
              <label>Medicine name *
                <input required value={medicine.name} onChange={(e) => setMedicines(medicines.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} />
              </label>
              <label>Dosage
                <input value={medicine.dosage} onChange={(e) => setMedicines(medicines.map((item, i) => i === index ? { ...item, dosage: e.target.value } : item))} placeholder="As clinically prescribed" />
              </label>
              <label>Frequency
                <input value={medicine.frequency} onChange={(e) => setMedicines(medicines.map((item, i) => i === index ? { ...item, frequency: e.target.value } : item))} />
              </label>
              <label>Duration
                <input value={medicine.duration} onChange={(e) => setMedicines(medicines.map((item, i) => i === index ? { ...item, duration: e.target.value } : item))} />
              </label>
              <label>Quantity
                <input type="number" min="0" step="1" value={medicine.quantity} onChange={(e) => setMedicines(medicines.map((item, i) => i === index ? { ...item, quantity: e.target.value } : item))} />
              </label>
              <label>Route
                <input value={medicine.route} onChange={(e) => setMedicines(medicines.map((item, i) => i === index ? { ...item, route: e.target.value } : item))} />
              </label>
              <label className="full">Medicine instructions
                <input value={medicine.instructions} onChange={(e) => setMedicines(medicines.map((item, i) => i === index ? { ...item, instructions: e.target.value } : item))} />
              </label>
              {medicines.length > 1 && <button className="doc-remove-medicine" type="button" onClick={() => setMedicines(medicines.filter((_, i) => i !== index))}>Remove this medicine</button>}
            </div>
          ))}
          <p className="doc-clinical-note">Review patient identity, allergies and clinical details before saving. This form records the doctor's decision; it does not recommend a medication.</p>
          <div className="doc-form-actions"><button className="doc-primary-button" disabled={saving || !patients.length}>{saving ? "Saving…" : "Save prescription"}</button></div>
        </form>
        <div className="doc-section-heading"><div><span className="doc-eyebrow">RECORDS</span><h2>Existing prescriptions</h2></div></div>
        <RecordCards items={prescriptions} kind="Prescription" emptyTitle="No prescriptions yet" emptyDetail="Prescriptions created by your account will appear here." />
      </>
    );
  }

  function renderSchedule() {
    return (
      <>
        <div className="doc-page-intro"><div><span className="doc-eyebrow">AVAILABILITY & HOURS</span><h2>My Schedule</h2><p>Maintain your own clinic hours, activity blocks, location and availability.</p></div></div>
        <form className="doc-form-panel" onSubmit={saveSchedule}>
          <div className="doc-form-title"><div><span className="doc-eyebrow">SCHEDULE MANAGEMENT</span><h3>Add schedule entry</h3></div></div>
          <div className="doc-form-grid">
            <label>Day *
              <select required value={String(scheduleForm.dayOfWeek)} onChange={(e) => setScheduleForm({ ...scheduleForm, dayOfWeek: e.target.value })}>
                {scheduleOptions.days.map((day) => <option key={String(day.value)} value={String(day.value)}>{day.label}</option>)}
              </select>
            </label>
            <label>Activity *
              <select required value={scheduleForm.activityType} onChange={(e) => setScheduleForm({ ...scheduleForm, activityType: e.target.value })}>
                {scheduleOptions.activityTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label>Start time *
              <input type="time" required value={scheduleForm.startTime} onChange={(e) => setScheduleForm({ ...scheduleForm, startTime: e.target.value })} />
            </label>
            <label>End time *
              <input type="time" required value={scheduleForm.endTime} onChange={(e) => setScheduleForm({ ...scheduleForm, endTime: e.target.value })} />
            </label>
            <label>Location
              <input maxLength={255} value={scheduleForm.location} onChange={(e) => setScheduleForm({ ...scheduleForm, location: e.target.value })} placeholder="Clinic / Room" />
            </label>
            <label>Notes
              <input maxLength={2000} value={scheduleForm.notes} onChange={(e) => setScheduleForm({ ...scheduleForm, notes: e.target.value })} />
            </label>
          </div>
          <label className="doc-checkbox-line"><input type="checkbox" checked={scheduleForm.available} onChange={(e) => setScheduleForm({ ...scheduleForm, available: e.target.checked })} /> Available for booking</label>
          <div className="doc-form-actions"><button className="doc-primary-button" disabled={saving}>{saving ? "Saving…" : "Add schedule entry"}</button></div>
        </form>

        <div className="doc-section-heading"><div><span className="doc-eyebrow">YOUR WEEK</span><h2>Schedule entries</h2></div></div>
        {schedule.length ? (
          <div className="doc-schedule-list">
            {schedule.map((entry, index) => {
              const id = entry.scheduleId ?? entry.schedule_id ?? entry.id;
              const available = entry.available === true || Number(entry.available) === 1;
              return (
                <article className="doc-schedule-card" key={id ?? index}>
                  <div className="doc-schedule-day">{valueText(entry.day_of_week)}</div>
                  <div className="doc-schedule-detail">
                    <strong>{entry.activity_type || "Schedule"}</strong>
                    <span>{timeText(entry.start_time)}–{timeText(entry.end_time)}</span>
                    <small>{entry.location || "Location not set"}{entry.notes ? ` · ${entry.notes}` : ""}</small>
                  </div>
                  <span className={`doc-status-pill ${available ? "scheduled" : "cancelled"}`}>{available ? "Available" : "Unavailable"}</span>
                  <div className="doc-row-actions">
                    <button onClick={() => toggleSchedule(entry)}>{available ? "Set unavailable" : "Set available"}</button>
                    <button className="danger" onClick={() => deleteSchedule(entry)}>Delete</button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : <DoctorEmpty title="No schedule entries" detail="Add schedule blocks so the front desk can coordinate bookings." />}
      </>
    );
  }

  function renderDischargeCare() {
    return (
      <>
        <div className="doc-page-intro"><div><span className="doc-eyebrow">RECOVERY & CONTINUITY</span><h2>Discharge Care</h2><p>Document discharge summaries and aftercare instructions for patients linked to your care.</p></div></div>
        <form className="doc-form-panel" onSubmit={saveDischargeCare}>
          <div className="doc-form-title"><div><span className="doc-eyebrow">NEW RECORD</span><h3>Create discharge care plan</h3></div></div>
          <div className="doc-form-grid">
            <label>Patient *
              <select required value={dischargeForm.patientId} onChange={(e) => setDischargeForm({ ...dischargeForm, patientId: e.target.value })}>
                <option value="">Choose linked patient</option>
                {patients.map((patient) => <option key={patient.patient_id} value={patient.patient_id}>{patient.full_name} · #{patient.patient_id}</option>)}
              </select>
            </label>
            <label>Discharge date *
              <input type="date" required value={dischargeForm.dischargeDate} onChange={(e) => setDischargeForm({ ...dischargeForm, dischargeDate: e.target.value })} />
            </label>
            <label className="full">Diagnosis *
              <textarea required rows={2} value={dischargeForm.diagnosis} onChange={(e) => setDischargeForm({ ...dischargeForm, diagnosis: e.target.value })} />
            </label>
            <label className="full">Treatment summary
              <textarea rows={2} value={dischargeForm.treatmentSummary} onChange={(e) => setDischargeForm({ ...dischargeForm, treatmentSummary: e.target.value })} />
            </label>
            <label className="full">Discharge instructions *
              <textarea required rows={3} value={dischargeForm.instructions} onChange={(e) => setDischargeForm({ ...dischargeForm, instructions: e.target.value })} />
            </label>
            <label className="full">Warning Signs / When to Seek Urgent Care *
              <textarea required rows={3} maxLength={5000} value={dischargeForm.warningSigns} onChange={(e) => setDischargeForm({ ...dischargeForm, warningSigns: e.target.value })} />
            </label>
            <label className="full">Discharge medicines summary
              <textarea rows={2} value={dischargeForm.medications} onChange={(e) => setDischargeForm({ ...dischargeForm, medications: e.target.value })} />
            </label>
            <label>Follow-up date
              <input type="date" value={dischargeForm.followUpDate} onChange={(e) => setDischargeForm({ ...dischargeForm, followUpDate: e.target.value })} />
            </label>
          </div>
          <p className="doc-clinical-note">Verify the care plan and follow-up dates before saving. Follow your organization’s discharge documentation process.</p>
          <div className="doc-form-actions"><button className="doc-primary-button" disabled={saving || !patients.length}>{saving ? "Saving…" : "Save discharge care"}</button></div>
        </form>
        <div className="doc-section-heading"><div><span className="doc-eyebrow">DOCUMENTATION</span><h2>Existing discharge records</h2></div></div>
        <RecordCards items={discharges} kind="Discharge care" emptyTitle="No discharge records" emptyDetail="Discharge records created by your account will appear here." />
      </>
    );
  }

  function renderClinicalAssistant() {
    return (
      <>
        <div className="doc-page-intro">
          <div>
            <span className="doc-eyebrow">CLINICAL DECISION SUPPORT</span>
            <h2>Clinical Assistant</h2>
            <p>Ask clinical questions and review the supporting medical evidence before making care decisions.</p>
          </div>
        </div>

        <section className="doc-assistant-panel doc-chat-shell">
          <div className="doc-assistant-header doc-chat-topbar">
            <span aria-hidden="true">?</span>
            <div>
              <strong>Clinical knowledge assistant</strong>
              <small>Evidence-aware clinical support ? Connected</small>
            </div>
            <button
              type="button"
              className="doc-chat-clear"
              onClick={() => setAssistantMessages([])}
              disabled={assistantLoading || assistantMessages.length === 0}
            >
              Clear chat
            </button>
          </div>

          <div className="doc-chat-thread" role="log" aria-live="polite" aria-label="Clinical conversation">
            {assistantMessages.length === 0 && (
              <div className="doc-chat-welcome">
                <div className="doc-chat-welcome-icon" aria-hidden="true">?</div>
                <h3>How can I help with your clinical question?</h3>
                <p>Ask about labeled indications, contraindications, warnings, or other topics covered by the available medical sources.</p>
                <small>Avoid including unnecessary patient-identifying information.</small>
              </div>
            )}

            {assistantMessages.map((message) => (
              <article
                key={message.id}
                className={`doc-chat-row doc-chat-row--${message.role}`}
              >
                <div className="doc-chat-avatar" aria-hidden="true">
                  {message.role === "user" ? "You" : message.role === "error" ? "!" : "AI"}
                </div>
                <div className="doc-chat-bubble">
                  <div className="doc-chat-speaker">
                    {message.role === "user" ? "You" : message.role === "error" ? "Unable to answer" : "Clinical Assistant"}
                  </div>
                  <p className="doc-chat-message-text">{message.content}</p>

                  {message.role === "assistant" && message.sources?.length > 0 && (
                    <div className="doc-chat-sources">
                      <span>Sources</span>
                      <div>
                        {message.sources.map((source, index) => (
                          <a
                            key={`${source.url}-${index}`}
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {source.title || `Source ${index + 1}`} ?
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {message.role === "assistant" && message.disclaimer && (
                    <small className="doc-chat-disclaimer">{message.disclaimer}</small>
                  )}
                </div>
              </article>
            ))}

            {assistantLoading && (
              <div className="doc-chat-row doc-chat-row--assistant">
                <div className="doc-chat-avatar" aria-hidden="true">AI</div>
                <div className="doc-chat-bubble doc-chat-thinking">
                  <span className="doc-chat-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                  Reviewing retrieved medical evidence?
                </div>
              </div>
            )}
            <div ref={assistantChatEndRef} />
          </div>

          <form className="doc-chat-composer" onSubmit={askClinicalAssistant}>
            <label className="doc-chat-sr-only" htmlFor="doc-question">Clinical question</label>
            <textarea
              id="doc-question"
              rows={2}
              maxLength={5000}
              required
              value={assistantQuestion}
              onChange={(event) => setAssistantQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Ask a clinical question? (Enter to send, Shift+Enter for a new line)"
              aria-label="Clinical question"
            />
            <button
              type="submit"
              className="doc-chat-send"
              disabled={assistantLoading || !assistantQuestion.trim()}
              aria-label="Send clinical question"
            >
              {assistantLoading ? "Thinking?" : "Send ?"}
            </button>
          </form>

          <div className="doc-chat-footer">
            Decision support only. Verify clinical information against the patient's chart and your local protocols.
          </div>
        </section>
      </>
    );
  }

  function renderOCR() {
    return (
      <>
        <div className="doc-page-intro"><div><span className="doc-eyebrow">DOCUMENT DIGITIZATION</span><h2>Prescription OCR</h2><p>Upload a prescription document and track its OCR job record for a patient in your care.</p></div></div>
        <form className="doc-form-panel" onSubmit={uploadPrescription}>
          <div className="doc-form-title"><div><span className="doc-eyebrow">NEW OCR JOB</span><h3>Upload prescription file</h3></div></div>
          <div className="doc-form-grid">
            <label>Patient *
              <select required value={ocrPatientId} onChange={(e) => setOcrPatientId(e.target.value)}>
                <option value="">Choose linked patient</option>
                {patients.map((patient) => <option key={patient.patient_id} value={patient.patient_id}>{patient.full_name} · #{patient.patient_id}</option>)}
              </select>
            </label>
            <label>Prescription file * (JPG, PNG, WEBP or PDF)
              <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" required onChange={(e) => setOcrFile(e.target.files?.[0] || null)} />
            </label>
          </div>
          <p className="doc-clinical-note">Maximum upload size: 10 MB. Files are stored in a private backend folder. Uploading creates an OCR job record; extraction results depend on the configured OCR worker.</p>
          <div className="doc-form-actions"><button className="doc-primary-button" disabled={saving || !ocrFile || !patients.length}>{saving ? "Uploading…" : "Upload and create OCR job"}</button></div>
        </form>
        <div className="doc-section-heading"><div><span className="doc-eyebrow">PROCESSING HISTORY</span><h2>OCR jobs</h2></div></div>
        <RecordCards items={ocrJobs} kind="OCR job" emptyTitle="No OCR jobs" emptyDetail="Uploaded prescription files and existing OCR job records will appear here." />
      </>
    );
  }

  function renderProfile() {
    return (
      <>
        <div className="doc-page-intro"><div><span className="doc-eyebrow">ACCOUNT & CREDENTIALS</span><h2>My Profile</h2><p>Update your professional details and sign-in credentials directly. These changes do not require Receptionist approval.</p></div></div>
        <form className="doc-form-panel" onSubmit={saveProfile}>
          <div className="doc-form-grid">
            <label>Full name *
              <input required maxLength={100} value={profileForm.fullName} onChange={(e) => setProfileForm({ ...profileForm, fullName: e.target.value })} />
            </label>
            <label>Email address *
              <input type="email" required maxLength={100} autoComplete="email" value={profileForm.email} onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })} />
            </label>
            <label>Phone
              <input maxLength={20} value={profileForm.phone} onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })} />
            </label>
            <label>Specialization
              <input maxLength={150} value={profileForm.specialization} onChange={(e) => setProfileForm({ ...profileForm, specialization: e.target.value })} />
            </label>
            <label>Qualification
              <input maxLength={150} value={profileForm.qualification} onChange={(e) => setProfileForm({ ...profileForm, qualification: e.target.value })} />
            </label>
            <label>Professional license number
              <input maxLength={100} value={profileForm.licenseNumber} onChange={(e) => setProfileForm({ ...profileForm, licenseNumber: e.target.value })} />
            </label>
            <label>Years of experience
              <input type="number" min="0" max="80" value={profileForm.experienceYears} onChange={(e) => setProfileForm({ ...profileForm, experienceYears: e.target.value })} />
            </label>
            <label className="full">Professional profile
              <textarea rows={4} maxLength={5000} value={profileForm.bio} onChange={(e) => setProfileForm({ ...profileForm, bio: e.target.value })} />
            </label>
          </div>

          <div className="doc-clinical-note">
            <strong>Sign-in security:</strong> Your updated email is saved to your own Doctor account. To change your email or password, enter your current password below. No Receptionist application is created.
          </div>
          <div className="doc-form-grid">
            <label>Current password <span>(required when changing email/password)</span>
              <input type="password" autoComplete="current-password" value={credentialForm.currentPassword} onChange={(e) => setCredentialForm({ ...credentialForm, currentPassword: e.target.value })} />
            </label>
            <label>New password <span>(leave blank to keep current password)</span>
              <input type="password" minLength={8} maxLength={72} autoComplete="new-password" value={credentialForm.newPassword} onChange={(e) => setCredentialForm({ ...credentialForm, newPassword: e.target.value })} />
            </label>
            <label>Confirm new password
              <input type="password" minLength={8} maxLength={72} autoComplete="new-password" value={credentialForm.confirmNewPassword} onChange={(e) => setCredentialForm({ ...credentialForm, confirmNewPassword: e.target.value })} />
            </label>
          </div>
          <div className="doc-form-actions"><button className="doc-primary-button" disabled={saving}>{saving ? "Saving…" : "Save profile and account changes"}</button></div>
        </form>
      </>
    );
  }  return (
    <div className="doc-layout">
      <aside className="doc-sidebar">
        <a className="doc-brand" href="#" onClick={(event) => { event.preventDefault(); goTo("overview"); }}>
          <span>✚</span><div><strong>HealthCare</strong><small>DOCTOR PORTAL</small></div>
        </a>
        <div className="doc-profile-mini">
          <span>{(user.fullName || "D").trim().charAt(0).toUpperCase()}</span>
          <div><strong>{user.fullName || "Doctor"}</strong><small>Clinical Staff</small></div>
        </div>
        <div className="doc-sidebar-caption">WORKSPACE</div>
        <nav className="doc-nav" aria-label="Doctor navigation">
          {DOCTOR_NAV.map((item) => (
            <button type="button" key={item.id} className={`doc-nav-item ${section === item.id ? "active" : ""}`} onClick={() => goTo(item.id)} aria-current={section === item.id ? "page" : undefined}>
              <span>{item.id === "profile" ? <HealthcareProfileIcon /> : item.icon}</span><b>{item.label}</b>{section === item.id && <i />}
            </button>
          ))}
        </nav>
        <div className="doc-sidebar-bottom">
          <div className="doc-clinical-boundary"><span>⛨</span><strong>Clinical workspace</strong><small>Use authorized patient records only.</small></div>
          <button type="button" className="doc-signout" onClick={onLogout}><span>↪</span> Sign Out</button>
          <small className="doc-sidebar-foot">Healthcare · Doctor portal</small>
        </div>
      </aside>

      <main className="doc-main">
        <header className="doc-topbar">
          <div><div className="doc-breadcrumb">Healthcare <span>/</span> Doctor <span>/</span> {activeItem?.label}</div><h1>{activeItem?.label}</h1></div>
          <div className="doc-topbar-account"><div><strong>{user.fullName}</strong><small>{user.email}</small></div><span>{(user.fullName || "D").trim().charAt(0).toUpperCase()}</span></div>
        </header>

        <div className="doc-content">
          {notice && <div className="doc-notice" role="status"><span>✓</span><p>{notice}</p><button onClick={() => setNotice("")}>×</button></div>}
          {error && <div className="doc-error" role="alert"><div><strong>Could not complete that action</strong><p>{error}</p></div><button onClick={() => { setError(""); loadSection(section); }}>Retry</button></div>}
          {busy && <div className="doc-loading"><span /> Loading data from the healthcare database…</div>}

          {!error && section === "overview" && renderOverview()}
          {!error && section === "patients" && renderPatients()}
          {!error && section === "appointments" && renderAppointments()}
          {!error && section === "prescriptions" && renderPrescriptions()}
          {!error && section === "schedule" && renderSchedule()}
          {!error && section === "care" && renderDischargeCare()}
          {!error && section === "assistant" && renderClinicalAssistant()}
          {!error && section === "ocr" && renderOCR()}
          {!error && section === "profile" && renderProfile()}
        </div>
        <footer className="doc-footer"><span>HealthCare <i>•</i> Doctor workspace</span><span>Role-protected APIs · Unified healthcare platform</span></footer>
      </main>
    </div>
  );
}
