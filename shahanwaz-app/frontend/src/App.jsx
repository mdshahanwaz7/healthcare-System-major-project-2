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
  const [selectedRole, setSelectedRole] = useState(() => {
    const roleFromLink = new URLSearchParams(window.location.search).get("role");
    return ["patient", "doctor", "receptionist"].includes(roleFromLink) ? roleFromLink : "patient";
  });
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
  // EMAIL_LINK_PASSWORD_RECOVERY_V1
  const [recoveryToken, setRecoveryToken] = useState(() => new URLSearchParams(window.location.search).get("resetToken") || "");
  const [recoveryStep, setRecoveryStep] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("resetToken");
    const role = params.get("role");
    return token && ["patient", "doctor", "receptionist"].includes(role) ? "reset-link" : "";
  });
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryNewPassword, setRecoveryNewPassword] = useState("");
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState("");

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
    const resetLinkParams = new URLSearchParams(window.location.search);
    if (resetLinkParams.has("resetToken")) {
      sessionStorage.removeItem("unifiedHealthcareToken");
      setCheckingSession(false);
      return () => { active = false; };
    }    const token = sessionStorage.getItem("unifiedHealthcareToken");

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

  // EMAIL_LINK_REMOVE_TOKEN_FROM_ADDRESS_BAR
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("resetToken")) {
      url.searchParams.delete("resetToken");
      url.searchParams.delete("role");
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);
  function changeMode(nextMode) {
    setRecoveryStep("");
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

  // EMAIL_LINK_PASSWORD_RECOVERY_V1
  function openForgotPassword() {
    setRecoveryEmail(email.trim());
    setRecoveryToken("");
    setRecoveryNewPassword("");
    setRecoveryConfirmPassword("");
    setError("");
    setNotice("");
    setRecoveryStep("request");
  }

  function closeForgotPassword() {
    setRecoveryStep("");
    setRecoveryToken("");
    setRecoveryNewPassword("");
    setRecoveryConfirmPassword("");
    setError("");
    setNotice("");
  }

  async function submitRecovery(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (recoveryStep === "reset-link" && recoveryNewPassword !== recoveryConfirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    if (recoveryStep === "reset-link" && (!recoveryToken || recoveryToken.length !== 64)) {
      setError("This password-reset link is invalid. Request a new reset link.");
      return;
    }

    setBusy(true);
    try {
      if (recoveryStep === "request") {
        const result = await apiRequest("/api/auth/forgot-password/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: recoveryEmail.trim(), role: selectedRole })
        });
        setRecoveryStep("sent");
        setNotice(result.message || "If an account matches this role and email, a password-reset link will be sent to that address.");
      } else if (recoveryStep === "reset-link") {
        const result = await apiRequest("/api/auth/forgot-password/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: recoveryToken, role: selectedRole, password: recoveryNewPassword })
        });
        setRecoveryStep("");
        setRecoveryToken("");
        setMode("login");
        setEmail(recoveryEmail.trim());
        setPassword("");
        setConfirmPassword("");
        setRecoveryNewPassword("");
        setRecoveryConfirmPassword("");
        setNotice(result.message || "Password reset successfully. Sign in using your new password.");
      }
    } catch (recoveryError) {
      setError(recoveryError.message || "Password recovery could not be completed. Please try again.");
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
    return <DoctorWorkspace user={user} onLogout={signOut} onUserUpdate={setUser} />;
  }
  if (user?.role === "receptionist") {
    return <ReceptionistWorkspace user={user} onLogout={signOut} onUserUpdate={setUser} />;
  }

  if (user?.role === "patient") {
    return <PatientWorkspace user={user} onLogout={signOut} onUserUpdate={setUser} />;
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

  // DEDICATED_STANDALONE_PASSWORD_RECOVERY_PAGE
  // EMAIL_LINK_PASSWORD_RECOVERY_V1: standalone screen for requesting a link or completing it.
  if (recoveryStep) {
    const isRequest = recoveryStep === "request";
    const isSent = recoveryStep === "sent";
    const isResetLink = recoveryStep === "reset-link";
    return (
      <main className="recovery-page">
        <section className="recovery-card" aria-labelledby="recovery-page-title">
          <div className="recovery-brand">
            <span className="recovery-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 48 48" role="img" focusable="false">
                <rect x="2" y="2" width="44" height="44" rx="14" fill="currentColor" opacity="0.12" />
                <path d="M24 12v24M12 24h24" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
              </svg>
            </span>
            <span>Healthcare</span>
          </div>

          <span className="recovery-eyebrow">SECURE ACCOUNT RECOVERY · {String(selectedRole || "patient").toUpperCase()}</span>
          <h1 id="recovery-page-title">
            {isRequest ? "Reset your password" : isSent ? "Check your email" : "Create a new password"}
          </h1>
          <p className="recovery-description">
            {isRequest
              ? "Enter the email address registered to your selected account. We will send a secure, single-use reset link."
              : isSent
                ? "If an account matches this role and email, a reset link will be sent. Check your inbox and spam folder. The link expires in 15 minutes."
                : "Choose a new password for your account. This reset link can be used only once and expires after 15 minutes."}
          </p>

          {error && <div className="recovery-feedback recovery-feedback-error" role="alert">{error}</div>}
          {notice && <div className="recovery-feedback recovery-feedback-success" role="status">{notice}</div>}

          {isRequest && (
            <form onSubmit={submitRecovery} className="recovery-form">
              <label className="recovery-label" htmlFor="recoveryEmail">Registered email</label>
              <input
                id="recoveryEmail"
                className="recovery-input"
                type="email"
                autoComplete="email"
                maxLength={100}
                value={recoveryEmail}
                onChange={(event) => setRecoveryEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
              <button className="recovery-submit" type="submit" disabled={busy}>
                {busy ? "Sending reset link…" : "Email me a reset link"}
              </button>
            </form>
          )}

          {isSent && (
            <div className="recovery-form">
              <button type="button" className="recovery-submit" onClick={() => { setRecoveryStep("request"); setNotice(""); setError(""); }}>
                Try another email
              </button>
            </div>
          )}

          {isResetLink && (
            <form onSubmit={submitRecovery} className="recovery-form">
              <label className="recovery-label" htmlFor="recoveryNewPassword">New password</label>
              <input
                id="recoveryNewPassword"
                className="recovery-input"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                value={recoveryNewPassword}
                onChange={(event) => setRecoveryNewPassword(event.target.value)}
                placeholder="At least 8 characters"
                required
              />
              <label className="recovery-label" htmlFor="recoveryConfirmPassword">Confirm new password</label>
              <input
                id="recoveryConfirmPassword"
                className="recovery-input"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                value={recoveryConfirmPassword}
                onChange={(event) => setRecoveryConfirmPassword(event.target.value)}
                placeholder="Enter the password again"
                required
              />
              <button className="recovery-submit" type="submit" disabled={busy}>
                {busy ? "Updating password…" : "Reset password"}
              </button>
            </form>
          )}

          <button type="button" className="recovery-back" onClick={closeForgotPassword} disabled={busy}>
            <span aria-hidden="true">←</span> Back to sign in
          </button>
          <p className="recovery-security-note">Your password is changed only after the backend validates the single-use reset link.</p>
        </section>
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
                : "Create a patient account or submit a Doctor application for Receptionist approval."}
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
                  setRecoveryStep("");
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

          <form onSubmit={handleSubmit} className="auth-form" hidden={Boolean(recoveryStep)}>
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

            {mode === "login" && (
              <button type="button" className="forgot-password-link" onClick={openForgotPassword}>
                Forgot password?
              </button>
            )}            <button className="button button-primary submit-button" type="submit" disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "login"
                  ? "Sign in securely"
                  : selectedRole === "doctor" ? "Submit Doctor Application" : "Create patient account"}
              {!busy && <span aria-hidden="true"> ↗</span>}
            </button>
          </form>

          {recoveryStep && (
            <form onSubmit={submitRecovery} className="auth-form recovery-form">
              <div className="recovery-form-heading">
                <h2>
                  {recoveryStep === "request"
                    ? "Reset your password"
                    : recoveryStep === "verify"
                      ? "Verify your email"
                      : "Choose a new password"}
                </h2>
                <p>
                  {recoveryStep === "request"
                    ? "Enter the email address registered to your selected account."
                    : recoveryStep === "verify"
                      ? "Enter the verification code sent to your registered email."
                      : "Your email has been verified. Create a new password."}
                </p>
              </div>

              {recoveryStep === "request" && (
                <>
                  <label className="field-label" htmlFor="recoveryEmail">
                    Registered email
                  </label>
                  <input
                    id="recoveryEmail"
                    type="email"
                    autoComplete="email"
                    value={recoveryEmail}
                    onChange={(event) => setRecoveryEmail(event.target.value)}
                    placeholder="Enter your registered email"
                    required
                  />
                  <button className="button button-primary submit-button" type="submit" disabled={busy}>
                    {busy ? "Sending code…" : "Send verification code"}
                  </button>
                </>
              )}

              {recoveryStep === "verify" && (
                <>
                  <label className="field-label" htmlFor="recoveryCode">
                    Six-digit verification code
                  </label>
                  <input
                    id="recoveryCode"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    value={recoveryCode}
                    onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="Enter verification code"
                    required
                  />
                  <button className="button button-primary submit-button" type="submit" disabled={busy}>
                    {busy ? "Verifying…" : "Verify code"}
                  </button>
                </>
              )}

              {recoveryStep === "reset" && (
                <>
                  <label className="field-label" htmlFor="recoveryNewPassword">
                    New password
                  </label>
                  <input
                    id="recoveryNewPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={recoveryNewPassword}
                    onChange={(event) => setRecoveryNewPassword(event.target.value)}
                    placeholder="At least 8 characters"
                    required
                  />

                  <label className="field-label" htmlFor="recoveryConfirmPassword">
                    Confirm new password
                  </label>
                  <input
                    id="recoveryConfirmPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={recoveryConfirmPassword}
                    onChange={(event) => setRecoveryConfirmPassword(event.target.value)}
                    placeholder="Enter your new password again"
                    required
                  />

                  <button className="button button-primary submit-button" type="submit" disabled={busy}>
                    {busy ? "Updating password…" : "Reset password"}
                  </button>
                </>
              )}

              <button
                type="button"
                className="forgot-password-link"
                onClick={closeForgotPassword}
                disabled={busy}
              >
                Back to login
              </button>
            </form>
          )}


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







