import { useCallback, useEffect, useState } from "react";

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001"
).replace(/\/$/, "");

export default function CareTeamInbox() {
  const [messages, setMessages] = useState([]);
  const [activePatientId, setActivePatientId] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const loadMessages = useCallback(async () => {
    const token = sessionStorage.getItem("unifiedHealthcareToken");

    try {
      const response = await fetch(`${API_BASE}/api/care-team/messages`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.message || "Unable to load the inbox");
      }

      const rows = Array.isArray(result.messages) ? result.messages : [];
      setMessages(rows);

      if (rows.length) {
        setActivePatientId((current) =>
          current || String(rows[rows.length - 1].patient_id)
        );
      }

      setError("");
    } catch (loadError) {
      setError(loadError.message || "Unable to connect to the care-team inbox");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMessages();
    const timer = window.setInterval(loadMessages, 15000);
    return () => window.clearInterval(timer);
  }, [loadMessages]);

  const threadsByPatient = new Map();

  for (const item of messages) {
    const key = String(item.patient_id);

    if (!threadsByPatient.has(key)) {
      threadsByPatient.set(key, {
        patientId: key,
        patientName: item.patient_name || `Patient ${key}`,
        patientEmail: item.patient_email || "",
        messages: []
      });
    }

    threadsByPatient.get(key).messages.push(item);
  }

  const threads = [...threadsByPatient.values()].sort((a, b) => {
    const at = a.messages[a.messages.length - 1]?.created_at || "";
    const bt = b.messages[b.messages.length - 1]?.created_at || "";
    return String(bt).localeCompare(String(at));
  });

  const activeThread = threads.find(
    (thread) => thread.patientId === String(activePatientId)
  );

  async function sendReply(event) {
    event.preventDefault();

    const text = reply.trim();
    if (!text || !activeThread || sending) return;

    setSending(true);
    setError("");

    try {
      const token = sessionStorage.getItem("unifiedHealthcareToken");
      const response = await fetch(`${API_BASE}/api/care-team/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          patientId: Number(activeThread.patientId),
          message: text
        })
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.message || "Unable to send your reply");
      }

      setReply("");
      await loadMessages();
    } catch (sendError) {
      setError(sendError.message || "Unable to send reply");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="care-team-inbox">
      <div className="care-team-heading">
        <div>
          <span className="patient-eyebrow">CONNECTED CARE</span>
          <h2>Post-discharge inbox</h2>
          <p>Messages addressed to your account from patients in their care conversations.</p>
        </div>
        <button type="button" className="patient-refresh-button" onClick={loadMessages}>
          ↻ Refresh
        </button>
      </div>

      {error && <div className="care-team-error" role="alert">{error}</div>}

      <div className="care-team-layout">
        <aside className="care-team-thread-list" aria-label="Patient conversations">
          {loading && <p className="care-team-muted">Loading conversations…</p>}

          {!loading && !threads.length && !error && (
            <div className="care-team-empty">
              <span>▤</span>
              <strong>No messages yet</strong>
              <p>Patient messages addressed to your account will appear here.</p>
            </div>
          )}

          {threads.map((thread) => {
            const last = thread.messages[thread.messages.length - 1];
            return (
              <button
                type="button"
                key={thread.patientId}
                className={`care-team-thread ${activePatientId === thread.patientId ? "active" : ""}`}
                onClick={() => setActivePatientId(thread.patientId)}
              >
                <span className="care-team-avatar">
                  {thread.patientName.trim().charAt(0).toUpperCase()}
                </span>
                <span className="care-team-thread-copy">
                  <strong>{thread.patientName}</strong>
                  <small>{last?.message || "Open conversation"}</small>
                </span>
              </button>
            );
          })}
        </aside>

        <div className="care-team-conversation">
          {activeThread ? (
            <>
              <header className="care-team-conversation-header">
                <div>
                  <strong>{activeThread.patientName}</strong>
                  <span>{activeThread.patientEmail}</span>
                </div>
                <span className="care-team-linked-badge">Patient thread</span>
              </header>

              <div className="care-team-message-list" aria-live="polite">
                {activeThread.messages.map((item, index) => {
                  const mine = item.sender_role === "doctor" || item.sender_role === "receptionist";

                  return (
                    <div
                      key={item.message_id || index}
                      className={`care-team-message-row ${mine ? "mine" : "theirs"}`}
                    >
                      <div className="care-team-message-bubble">
                        <span>{item.sender_name || "Care team"}</span>
                        <p>{item.message}</p>
                        <small>
                          {item.created_at
                            ? new Date(item.created_at).toLocaleString()
                            : ""}
                        </small>
                      </div>
                    </div>
                  );
                })}
              </div>

              <form className="care-team-reply-form" onSubmit={sendReply}>
                <label className="patient-visually-hidden" htmlFor="care-team-reply">
                  Reply to patient
                </label>
                <textarea
                  id="care-team-reply"
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  maxLength={3000}
                  rows={2}
                  placeholder="Write a reply to this patient…"
                  required
                />
                <button type="submit" disabled={sending || !reply.trim()}>
                  {sending ? "Sending…" : "Send reply ↗"}
                </button>
              </form>
            </>
          ) : (
            <div className="care-team-empty care-team-empty-main">
              <span>♡</span>
              <strong>Select a conversation</strong>
              <p>Choose a patient thread on the left to view and reply to its messages.</p>
            </div>
          )}
        </div>
      </div>
      <p className="care-team-note">
        Share clinical guidance only within your role and follow your organization's care procedures.
      </p>
    </section>
  );
}
