import { useEffect, useState } from "react";
import "./index.css";
import DoctorWorkspace from "./DoctorWorkspace";
import ReceptionistWorkspace from "./ReceptionistWorkspace";
import PatientWorkspace from "./PatientWorkspace";
import CareTeamInbox from "./CareTeamInbox";

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001"
).replace(/\/$/, "");

const roleContent = {
  patient: {
    label: "Patient",
    eyebrow: "YOUR HEALTH, IN ONE PLACE",
    title: "Your care journey",
    description:
      "Access your healthcare services through one connected account.",
    items: [
      ["Appointments", "View and manage your appointments."],
      ["Medical records", "Access your authorized medical information."],
      ["Prescriptions", "Review prescriptions linked to your account."]
    ]
  },
  doctor: {
    label: "Doctor",
    eyebrow: "CLINICAL WORKSPACE",
    title: "Your clinical workspace",
    description:
      "A shared workspace for the clinical services available to your account.",
    items: [
      ["Appointments", "A workspace for patient appointment management."],
      ["Patient records", "A workspace for authorized clinical information."],
      ["Prescriptions", "A workspace for prescription management."]
    ]
  },
  receptionist: {
    label: "Receptionist",
    eyebrow: "FRONT DESK WORKSPACE",
    title: "Your operations workspace",
    description:
      "A connected starting point for patient and appointment coordination.",
    items: [
      ["Appointment desk", "A workspace for appointment coordination."],
      ["Patient directory", "A workspace for patient registration and lookup."],
      ["Scheduling", "A workspace for coordinating schedules."]
    ]
  }
};

async function apiRequest(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, options);
  } catch {
    throw new Error(
      "Cannot reach the backend. Make sure the unified API is running on port 5001."
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `Request failed with status ${response.status}`);
  }

  return data;
}

function App() {
  const [mode, setMode] = useState("login");
  const [selectedRole, setSelectedRole] = useState("patient");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [doctorDetails, setDoctorDetails] = useState({
    specialization: "",
    qualification: "",
    licenseNumber: "",
    experienceYears: "",
    bio: ""
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadCurrentUser(token) {
    const data = await apiRequest("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` }
    });

    setUser(data.user);
    setProfile(data.profile || null);
    return data;
  }

  useEffect(() => {
    let active = true;
    const token = sessionStorage.getItem("unifiedHealthcareToken");

    if (!token) {
      setCheckingSession(false);
      return () => {
        active = false;
      };
    }

    (async () => {
      try {
        const response = await apiRequest("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (active) {
          setUser(response.user);
          setProfile(response.profile || null);
        }
      } catch {
        sessionStorage.removeItem("unifiedHealthcareToken");
        if (active) {
          setError("Your session has expired. Please sign in again.");
        }
      } finally {
        if (active) setCheckingSession(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  function changeMode(nextMode) {
    setMode(nextMode);
    setError("");
    setNotice("");
    setPassword("");
    setConfirmPassword("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    const isRegistering = mode === "register";

    if (isRegistering && selectedRole === "receptionist") {
      setError("Receptionist accounts must be provisioned by an administrator.");
      return;
    }

    if (isRegistering && password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setBusy(true);

    try {
      const payload = isRegistering
        ? {
            fullName: fullName.trim(),
            email: email.trim(),
            password,
            phone: phone.trim() || undefined,
            ...(selectedRole === "doctor" ? {
              specialization: doctorDetails.specialization.trim(),
              qualification: doctorDetails.qualification.trim(),
              licenseNumber: doctorDetails.licenseNumber.trim(),
              experienceYears: doctorDetails.experienceYears,
              bio: doctorDetails.bio.trim()
            } : {})
          }
        : {
            email: email.trim(),
            password
          };

      const endpoint = isRegistering
        ? selectedRole === "doctor" ? "/api/doctor-registration" : "/api/auth/register"
        : "/api/auth/login";

      const result = await apiRequest(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (isRegistering) {
        sessionStorage.removeItem("unifiedHealthcareToken");
        setPassword("");
        setConfirmPassword("");
        setMode("login");
        setNotice(result.message || "Registration submitted. Please sign in when your account is ready.");
        return;
      }

      if (result.user?.role !== selectedRole) {
        throw new Error(
          `These credentials belong to the ${roleContent[result.user?.role]?.label || result.user?.role} role. Please select the matching role.`
        );
      }

      sessionStorage.setItem("unifiedHealthcareToken", result.token);
      await loadCurrentUser(result.token);
      setPassword("");
      setConfirmPassword("");
      setNotice(result.message || "Login successful.");
    } catch (requestError) {
      setError(requestError.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    sessionStorage.removeItem("unifiedHealthcareToken");
    setUser(null);
    setProfile(null);
    setMode("login");
    setPassword("");
    setConfirmPassword("");
    setError("");
    setNotice("You have signed out.");
  }

  if (checkingSession) {
    return (
      <main className="loading-screen">
        <div className="loading-orb" />
        <p>Preparing your secure workspace…</p>
      </main>
    );
  }

  if (user?.role === "doctor") {
    return <DoctorWorkspace user={user} onLogout={signOut} />;
  }
  if (user?.role === "receptionist") {
    return <ReceptionistWorkspace user={user} onLogout={signOut} />;
  }

  if (user?.role === "patient") {
    return <PatientWorkspace user={user} onLogout={signOut} />;
  }

  if (user) {
    const content = roleContent[user.role] || roleContent.patient;

    return (
      <main className="app-shell dashboard-shell">
        <header className="topbar">
          <a className="brand" href="#" aria-label="CareUnity home">
            <span className="brand-mark">+</span>
            <span>CareUnity</span>
          </a>
          <div className="account-area">
            <div className="account-copy">
              <strong>{user.fullName}</strong>
              <span>{content.label} account</span>
            </div>
            <button className="button button-quiet" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>

        <section className="dashboard-hero">
          <div className="dashboard-hero-copy">
            <span className="eyebrow">{content.eyebrow}</span>
            <h1>{content.title}<span className="accent-dot">.</span></h1>
            <p>{content.description}</p>
            <div className="identity-chip">
              <span className="status-dot" />
              Signed in as {user.email}
            </div>
          </div>
          <div className="hero-symbol" aria-hidden="true">
            <div className="hero-ring ring-one" />
            <div className="hero-ring ring-two" />
            <span>✚</span>
          </div>
        </section>

        <section className="section-heading">
          <div>
            <span className="eyebrow">YOUR WORKSPACE</span>
            <h2>Healthcare services</h2>
          </div>
          <span className="role-pill">{content.label}</span>
        </section>

        <section className="service-grid">
          {content.items.map(([title, description], index) => (
            <article className="service-card" key={title}>
              <div className={`service-icon icon-${index + 1}`}>
                {["✳", "▤", "⌘"][index]}
              </div>
              <span className="service-number">0{index + 1}</span>
              <h3>{title}</h3>
              <p>{description}</p>
              <span className="coming-soon">Feature integration next</span>
            </article>
          ))}
        </section>

        {(user.role === "doctor" || user.role === "receptionist") && <CareTeamInbox />}
        <section className="profile-panel">
          <div>
            <span className="eyebrow">ACCOUNT DETAILS</span>
            <h2>Your profile</h2>
          </div>
          <div className="profile-details">
            <div>
              <span>Full name</span>
              <strong>{user.fullName}</strong>
            </div>
            <div>
              <span>Email address</span>
              <strong>{user.email}</strong>
            </div>
            <div>
              <span>Phone</span>
              <strong>{user.phone || "Not provided"}</strong>
            </div>
            {user.role === "doctor" && (
              <div>
                <span>Specialization</span>
                <strong>{profile?.specialization || "Not yet set"}</strong>
              </div>
            )}
            {user.role === "patient" && (
              <div>
                <span>Profile status</span>
                <strong>{profile ? "Patient profile linked" : "Profile not found"}</strong>
              </div>
            )}
          </div>
        </section>

        <footer className="footer">
          <span>CareUnity</span>
          <span>Unified healthcare platform · Role-based workspace</span>
        </footer>
      </main>
    );
  }

  return (
    <main className="app-shell auth-layout">
      <section className="welcome-panel">
        <header className="topbar">
          <a className="brand" href="#" aria-label="CareUnity home">
            <span className="brand-mark">+</span>
            <span>CareUnity</span>
          </a>
          <span className="topbar-note">One connected experience</span>
        </header>

        <div className="welcome-copy">
          <span className="eyebrow">A MORE CONNECTED WAY TO CARE</span>
          <h1>Healthcare,<br />in harmony<span className="accent-dot">.</span></h1>
          <p>
            One secure starting point for patients, clinicians and healthcare
            teams—with a workspace shaped around your role.
          </p>
          <div className="welcome-features">
            <div className="welcome-feature">
              <span className="feature-check">✓</span>
              <span>Role-aware account access</span>
            </div>
            <div className="welcome-feature">
              <span className="feature-check">✓</span>
              <span>Connected healthcare services</span>
            </div>
            <div className="welcome-feature">
              <span className="feature-check">✓</span>
              <span>One unified interface</span>
            </div>
          </div>
        </div>

        <div className="orb orb-large" />
        <div className="orb orb-small" />
        <div className="welcome-bottom">
          <span className="pulse-dot" />
          A unified platform built around your care
        </div>
      </section>

      <section className="form-panel">
        <div className="form-card">
          <div className="form-heading">
            <span className="eyebrow">{mode === "login" ? "WELCOME BACK" : "GET STARTED"}</span>
            <h2>{mode === "login" ? "Sign in to your account" : "Create your account"}</h2>
            <p>
              {mode === "login"
                ? "Enter your details to continue to your workspace."
                : "Create a patient account to get started."}
            </p>
          </div>

          <div className="mode-switch" role="tablist" aria-label="Account access">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={mode === "login" ? "mode-tab active" : "mode-tab"}
              onClick={() => changeMode("login")}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "register"}
              disabled={selectedRole === "receptionist"}
              disabled={selectedRole !== "patient"}
              className={mode === "register" ? "mode-tab active" : "mode-tab"}
              onClick={() => changeMode("register")}
            >
              Create account
            </button>
          </div>

          <div className="role-switch-label">CHOOSE YOUR ROLE</div>
          <div className="role-switch" role="group" aria-label="Choose account role">
            {[
              { value: "patient", label: "Patient", symbol: "♡" },
              { value: "receptionist", label: "Receptionist", symbol: "▦" },
              { value: "doctor", label: "Doctor", symbol: "✚" }
            ].map((roleOption) => (
              <button
                type="button"
                key={roleOption.value}
                className={`role-option ${selectedRole === roleOption.value ? "selected" : ""}`}
                aria-pressed={selectedRole === roleOption.value}
                onClick={() => {
                  setSelectedRole(roleOption.value);
                  setError("");
                  setNotice("");
                  setPassword("");
                  setConfirmPassword("");
                  if (roleOption.value === "receptionist") {
                    setMode("login");
                  }
                }}
              >
                <span className="role-option-symbol">{roleOption.symbol}</span>
                <span>{roleOption.label}</span>
              </button>
            ))}
          </div>
          <p className="role-switch-help">
            {selectedRole === "patient"
              ? "Sign in as a patient, or create a patient account."
              : selectedRole === "doctor"
                ? "Already approved? Sign in. New doctors can submit an application for Receptionist verification."
                : "Sign in with the existing Receptionist account. Receptionist access must be provisioned by an administrator."}
          </p>
          {error && <div className="message message-error" role="alert">{error}</div>}
          {notice && <div className="message message-success" role="status">{notice}</div>}

          <form onSubmit={handleSubmit} className="auth-form">
            {mode === "register" && (
              <>
                <label className="field-label" htmlFor="fullName">Full name</label>
                <input
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  maxLength={100}
                  placeholder="Enter your full name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                />

                <label className="field-label" htmlFor="phone">
                  Phone number <span className="optional-label">Optional</span>
                </label>
                <input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  maxLength={20}
                  placeholder="Enter your phone number"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </>
            )}

            {mode === "register" && selectedRole === "doctor" && (
            <>
              <label className="field-label" htmlFor="specialization">Specialization *</label>
              <input
                id="specialization"
                value={doctorDetails.specialization}
                onChange={(event) => setDoctorDetails({ ...doctorDetails, specialization: event.target.value })}
                maxLength={150}
                placeholder="e.g. General Medicine"
                required
              />

              <label className="field-label" htmlFor="qualification">Qualification</label>
              <input
                id="qualification"
                value={doctorDetails.qualification}
                onChange={(event) => setDoctorDetails({ ...doctorDetails, qualification: event.target.value })}
                maxLength={150}
                placeholder="e.g. MBBS, MD"
              />

              <label className="field-label" htmlFor="licenseNumber">Professional license number *</label>
              <input
                id="licenseNumber"
                value={doctorDetails.licenseNumber}
                onChange={(event) => setDoctorDetails({ ...doctorDetails, licenseNumber: event.target.value })}
                maxLength={100}
                placeholder="Enter your professional registration number"
                required
              />

              <label className="field-label" htmlFor="experienceYears">Years of experience</label>
              <input
                id="experienceYears"
                type="number"
                min="0"
                max="80"
                step="1"
                value={doctorDetails.experienceYears}
                onChange={(event) => setDoctorDetails({ ...doctorDetails, experienceYears: event.target.value })}
              />

              <label className="field-label" htmlFor="doctorBio">Professional profile</label>
              <textarea
                id="doctorBio"
                value={doctorDetails.bio}
                onChange={(event) => setDoctorDetails({ ...doctorDetails, bio: event.target.value })}
                maxLength={5000}
                rows={3}
                placeholder="Optional professional introduction"
              />
            </>
          )}
          <label className="field-label" htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              maxLength={100}
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />

            <label className="field-label" htmlFor="password">Password</label>
            <div className="password-wrap">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={8}
                placeholder={mode === "login" ? "Enter your password" : "At least 8 characters"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                className="show-password"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>

            {mode === "register" && (
              <>
                <label className="field-label" htmlFor="confirmPassword">Confirm password</label>
                <input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={8}
                  placeholder="Enter your password again"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
                <p className="form-hint">
                  Public sign-up creates a patient account. Doctor and receptionist
                  access is managed separately.
                </p>
              </>
            )}

            <button className="button button-primary submit-button" type="submit" disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "login"
                  ? "Sign in securely"
                  : selectedRole === "doctor" ? "Submit Doctor Application" : "Create patient account"}
              {!busy && <span aria-hidden="true"> ↗</span>}
            </button>
          </form>

          <p className="security-note">
            <span aria-hidden="true">◈</span>
            Your session is protected with token-based authentication.
          </p>
        </div>

        <footer className="form-footer">
          Need access help? Contact your healthcare administrator.
        </footer>
      </section>
    </main>
  );
}

export default App;







