import { useEffect, useState } from "react";

function renderAssistantMarkdown(markdown) {
  // Normalize escaped Markdown markers before parsing them.
  const normalized = String(markdown ?? "").replace(/\\([*_])/g, "$1");
  const tokenPattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;

  return normalized.split(/\r?\n/).map((line, lineIndex) => {
    if (/^\s*---+\s*$/.test(line)) {
      return <hr className="patient-ai-markdown-rule" key={`rule-${lineIndex}`} />;
    }

    if (!line.trim()) {
      return (
        <div
          className="patient-ai-markdown-spacer"
          key={`space-${lineIndex}`}
          aria-hidden="true"
        />
      );
    }

    const bulletMatch = line.match(/^(\s*[•-]\s+)(.*)$/);
    const prefix = bulletMatch ? bulletMatch[1] : "";
    const content = bulletMatch ? bulletMatch[2] : line;

    const parts = content.split(tokenPattern).map((part, partIndex) => {
      if (
        part.startsWith("**") &&
        part.endsWith("**") &&
        part.length >= 4
      ) {
        return <strong key={partIndex}>{part.slice(2, -2)}</strong>;
      }

      if (
        part.startsWith("*") &&
        part.endsWith("*") &&
        part.length >= 3
      ) {
        return <em key={partIndex}>{part.slice(1, -1)}</em>;
      }

      return part;
    });

    return (
      <div
        className={`patient-ai-markdown-line${bulletMatch ? " patient-ai-markdown-bullet" : ""}`}
        key={`line-${lineIndex}`}
      >
        {prefix}
        {parts}
      </div>
    );
  });
}

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001"
).replace(/\/$/, "");

const navigation = [
  { id: "dashboard", label: "My Dashboard", symbol: "⌂" },
  { id: "care", label: "Post-Discharge Care", symbol: "♡" },
  { id: "chat", label: "Post-Discharge Chat", symbol: "▤" },
  { id: "assistant", label: "AI Care Assistant", symbol: "\u2728" },
  { id: "prescriptions", label: "My Prescription", symbol: "✚" },
  { id: "history", label: "Medical History", symbol: "▧" },
];

async function patientApi(path, options = {}) {
  const token = sessionStorage.getItem("unifiedHealthcareToken");

  if (!token) {
    throw new Error("Your session has expired. Please sign in again.");
  }

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
      "Cannot reach the healthcare backend. Check that the API is running on port 5001."
    );
  }

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    throw new Error("Your session has expired. Please sign in again.");
  }
  if (!response.ok) {
    throw new Error(data.message || `Request failed (${response.status}).`);
  }
  return data;
}

function displayLabel(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function RecordCard({ record, index, kind }) {
  const entries = Object.entries(record || {}).filter(
    ([key, value]) =>
      !["password", "password_hash", "token"].includes(key.toLowerCase()) &&
      value !== null &&
      value !== undefined &&
      value !== ""
  );

  const headingKeys =
    kind === "prescription"
      ? ["prescription_name", "medicine_name", "title", "prescription_id", "diagnosis"]
      : kind === "discharge"
        ? ["discharge_date", "discharged_at", "title", "discharge_id", "diagnosis"]
        : ["condition", "diagnosis", "title", "record_type", "history_id"];

  const headingEntry = entries.find(([key]) =>
    headingKeys.includes(key.toLowerCase())
  );

  const title = headingEntry
    ? displayValue(headingEntry[1])
    : `${kind === "prescription" ? "Prescription" : kind === "discharge" ? "Discharge record" : "Medical record"} ${index + 1}`;

  return (
    <article className="patient-record-card" key={`${kind}-${index}`}>
      <div className="patient-record-heading">
        <div className={`patient-record-icon ${kind}`}>
          {kind === "prescription" ? "✚" : kind === "discharge" ? "♡" : "▧"}
        </div>
        <div className="patient-record-title">
          <h3>{title}</h3>
          <span>{displayLabel(kind)} · Record {index + 1}</span>
        </div>
      </div>
      <dl className="patient-record-fields">
        {entries.slice(0, 12).map(([key, value]) => (
          <div key={key} className="patient-record-field">
            <dt>{displayLabel(key)}</dt>
            <dd>{displayValue(value)}</dd>
          </div>
        ))}
      </dl>
      {entries.length > 12 && (
        <p className="patient-muted">Additional fields are available in the linked record.</p>
      )}
    </article>
  );
}

function EmptyState({ symbol, title, description }) {
  return (
    <div className="patient-empty-state">
      <div className="patient-empty-symbol">{symbol}</div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function StatCard({ label, value, symbol, note }) {
  return (
    <article className="patient-stat-card">
      <div className="patient-stat-top">
        <span>{label}</span>
        <span className="patient-stat-symbol">{symbol}</span>
      </div>
      <strong>{value ?? "—"}</strong>
      <p>{note}</p>
    </article>
  );
}

export default function PatientWorkspace({ user, onLogout }) {
  const [activeSection, setActiveSection] = useState("dashboard");
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [discharges, setDischarges] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [history, setHistory] = useState([]);
  const [chatData, setChatData] = useState({ messages: [], doctor: null });
  const [contacts, setContacts] = useState([]);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const [preferredLanguage, setPreferredLanguage] = useState(() => {
    const saved = sessionStorage.getItem("patientAssistantLanguage") || "en";
    return ["en", "hi", "mr", "gu"].includes(saved) ? saved : "en";
  });
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantMessages, setAssistantMessages] = useState([]);
  const [assistantSending, setAssistantSending] = useState(false);


  async function loadSection(section, quiet = false) {
    if (!quiet) setLoading(true);
    setPageError("");

    const endpoints = {
      dashboard: "/api/patient/dashboard",
      care: "/api/patient/discharges",
      chat: "/api/patient/chat",
      prescriptions: "/api/patient/prescriptions",
      history: "/api/patient/medical-history",
    };

    try {
      const requestPath =
        section === "chat" && selectedContactId
          ? `${endpoints[section]}?contactId=${encodeURIComponent(selectedContactId)}`
          : endpoints[section];
      const result = await patientApi(requestPath);

      if (section === "dashboard") setDashboard(result);
      if (section === "care") {
        setDischarges(Array.isArray(result.discharges) ? result.discharges : result.items || []);
      }
      if (section === "prescriptions") {
        setPrescriptions(Array.isArray(result.prescriptions) ? result.prescriptions : result.items || []);
      }
      if (section === "history") {
        setHistory(Array.isArray(result.records) ? result.records : result.items || []);
      }
      if (section === "chat") {
        const availableContacts = Array.isArray(result.contacts) ? result.contacts : [];
        setContacts(availableContacts);
        setChatData({
          messages: Array.isArray(result.messages) ? result.messages : [],
          doctor: result.contact || null,
        });

        if (!selectedContactId && availableContacts.length) {
          setSelectedContactId(String(availableContacts[0].user_id));
        }
      }
    } catch (error) {
      setPageError(error.message || "Unable to load this section.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    if (activeSection === "assistant") return;
    loadSection(activeSection);
  }, [activeSection]);

  useEffect(() => {
    sessionStorage.setItem("patientAssistantLanguage", preferredLanguage);
  }, [preferredLanguage]);

  useEffect(() => {
    if (activeSection !== "chat") return undefined;
    const timer = window.setInterval(() => loadSection("chat", true), 15000);
    return () => window.clearInterval(timer);
  }, [activeSection]);

  async function sendMessage(event) {
    event.preventDefault();
    const text = message.trim();
    if (!text || sending) return;

    setSending(true);
    setPageError("");
    try {
      await patientApi("/api/patient/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, recipientUserId: Number(selectedContactId) }),
      });
      setMessage("");
      await loadSection("chat", true);
    } catch (error) {
      setPageError(error.message || "Your message could not be sent.");
    } finally {
      setSending(false);
    }
  }


  async function submitAssistantQuestion(eventOrQuestion) {
    const isSuggestedQuestion = typeof eventOrQuestion === "string";
    if (!isSuggestedQuestion) eventOrQuestion.preventDefault();
    const question = (isSuggestedQuestion ? eventOrQuestion : assistantQuestion).trim();
    const language = preferredLanguage;

    if (!question || assistantSending) return;

    setAssistantSending(true);
    setAssistantQuestion("");
    setAssistantMessages(current => [
      ...current,
      {
        id: `patient-${Date.now()}`,
        role: "patient",
        text: question,
        language
      }
    ]);

    try {
      const result = await patientApi("/api/patient/assistant", {
        method: "POST",
        body: JSON.stringify({ question, language })
      });

      setAssistantMessages(current => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: result.answer || "The assistant returned no answer.",
          language: result.language || language,
          sources: Array.isArray(result.sources) ? result.sources : [],
          verificationStatus: result.verification_status || "unknown",
          isGrounded: Boolean(result.is_grounded),
          isEmergency: Boolean(result.is_emergency),
          abstained: Boolean(result.abstained)
        }
      ]);
    } catch (error) {
      setAssistantMessages(current => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          text: error.message || "The assistant could not process your question.",
          language,
          sources: [],
          isError: true
        }
      ]);
    } finally {
      setAssistantSending(false);
    }
  }

  const title = navigation.find((item) => item.id === activeSection)?.label || "My Dashboard";
  const stats = dashboard?.summary || {};
  const messages = chatData.messages || [];

  function selectSection(id) {
    setActiveSection(id);
  }

  function renderDashboard() {
    return (
      <>
        <section className="patient-welcome-banner">
          <div className="patient-welcome-copy">
            <span className="patient-eyebrow">YOUR PERSONAL HEALTH SPACE</span>
            <h2>Hello, {user.fullName?.split(" ")[0] || "there"}<span>.</span></h2>
            <p>Keep track of your recovery, prescriptions and care-team updates in one place.</p>
          </div>
          <div className="patient-welcome-art" aria-hidden="true">
            <span>✚</span>
            <i />
            <b />
          </div>
        </section>

        <div className="patient-section-heading">
          <div>
            <span className="patient-eyebrow">AT A GLANCE</span>
            <h2>Your health overview</h2>
          </div>
          <button className="patient-refresh-button" onClick={() => loadSection("dashboard")}>
            ↻ Refresh
          </button>
        </div>

        <div className="patient-stats-grid">
          <StatCard label="Discharge records" value={stats.dischargeCount ?? stats.discharge_count ?? "—"} symbol="♡" note="Your recovery records" />
          <StatCard label="Prescriptions" value={stats.prescriptionCount ?? stats.prescription_count ?? "—"} symbol="✚" note="Prescriptions on file" />
          <StatCard label="Medical history" value={stats.historyCount ?? stats.history_count ?? "—"} symbol="▧" note="Records linked to you" />
          <StatCard label="Care messages" value={stats.messageCount ?? stats.message_count ?? "—"} symbol="▤" note="Post-discharge messages" />
        </div>

        <div className="patient-section-heading">
          <div>
            <span className="patient-eyebrow">YOUR CARE</span>
            <h2>Quick access</h2>
          </div>
        </div>
        <div className="patient-quick-grid">
          {navigation.filter((item) => item.id !== "dashboard").map((item) => (
            <button className="patient-quick-card" key={item.id} onClick={() => selectSection(item.id)}>
              <span className="patient-quick-symbol">{item.symbol}</span>
              <span className="patient-quick-text">
                <strong>{item.label}</strong>
                <small>{{
                  care: "View your discharge instructions and follow-up details.",
                  chat: "Continue a conversation with your care team.",
                  prescriptions: "Review your prescribed medicines.",
                  history: "View your linked medical-history records.",
                }[item.id]}</small>
              </span>
              <span className="patient-quick-arrow">↗</span>
            </button>
          ))}
        </div>
      </>
    );
  }

  function renderCare() {
    return (
      <>
        <div className="patient-page-intro">
          <span className="patient-eyebrow">RECOVERY & FOLLOW-UP</span>
          <h2>Post-discharge care</h2>
          <p>Review the discharge information and aftercare guidance recorded by your healthcare team.</p>
        </div>
        {discharges.length ? (
          <div className="patient-record-list">
            {discharges.map((record, index) => (
              <RecordCard key={record.discharge_id ?? index} record={record} index={index} kind="discharge" />
            ))}
          </div>
        ) : !loading && !pageError ? (
          <EmptyState symbol="♡" title="No discharge records yet" description="Discharge records entered by your care team will appear here." />
        ) : null}
      </>
    );
  }

  function renderPrescriptions() {
    return (
      <>
        <div className="patient-page-intro">
          <span className="patient-eyebrow">MEDICATIONS</span>
          <h2>My prescription</h2>
          <p>Review prescription records linked to your patient profile.</p>
        </div>
        {prescriptions.length ? (
          <div className="patient-record-list">
            {prescriptions.map((record, index) => (
              <RecordCard key={record.prescription_id ?? index} record={record} index={index} kind="prescription" />
            ))}
          </div>
        ) : !loading && !pageError ? (
          <EmptyState symbol="✚" title="No prescriptions available" description="When a clinician records a prescription for you, it will appear here." />
        ) : null}
      </>
    );
  }


  function renderAssistant() {
    const languages = [
      { code: "en", label: "English" },
      { code: "hi", label: "Hindi" },
      { code: "mr", label: "Marathi" },
      { code: "gu", label: "Gujarati" }
    ];

    const suggestedQueries = {
      en: [
        "What are the uses and indications of metformin?",
        "I have severe chest pain and difficulty breathing",
        "Can I take aspirin and warfarin together?"
      ],
      hi: [
        "मेटफॉर्मिन के उपयोग और संकेत क्या हैं?",
        "सीने में तेज दर्द और सांस लेने में तकलीफ हो रही है",
        "क्या मैं एस्पिरिन और वारफारिन एक साथ ले सकता हूँ?"
      ],
      mr: [
        "उच्च रक्तदाबासाठी लिसिनोप्रिल 5 mg चा वापर काय आहे?",
        "माझ्या छातीत खूप तीव्र वेदना होत आहेत आणि मला श्वास घेता येत नाही",
        "मेटफॉर्मिनचे दुष्परिणाम काय आहेत?"
      ],
      gu: [
        "મેટફોર્મિનનો ઉપયોગ અને સંકેતો શું છે?",
        "મને છાતીમાં તીવ્ર દુખાવો અને શ્વાસ લેવામાં તકલીફ થઈ રહી છે",
        "શું હું એસ્પિરિન અને વૉરફરિન એકસાથે લઈ શકું?"
      ]
    };

    const suggestionHeading = {
      en: "Suggested questions",
      hi: "सुझाए गए प्रश्न",
      mr: "सुचवलेले प्रश्न",
      gu: "સૂચિત પ્રશ્નો"
    };

    const policyTitle = {
      en: "Safety Policy Notice",
      hi: "सुरक्षा नीति सूचना",
      mr: "सुरक्षा धोरण सूचना",
      gu: "સુરક્ષા નીતિ સૂચના"
    };

    const policyNotice = {
      en: "Your question is evaluated using authorized EHR history and discharge instructions. Medication-safety checks and evidence-grounding rules are applied; unsupported answers may be withheld.",
      hi: "आपके प्रश्न का मूल्यांकन अधिकृत स्वास्थ्य रिकॉर्ड और डिस्चार्ज निर्देशों के आधार पर किया जाता है। दवा-सुरक्षा जाँच और प्रमाण-आधारित सत्यापन लागू होते हैं; पर्याप्त प्रमाण न होने पर उत्तर रोका जा सकता है।",
      mr: "तुमच्या प्रश्नाचे मूल्यमापन अधिकृत आरोग्य नोंदी आणि डिस्चार्ज सूचनांच्या आधारे केले जाते. औषध-सुरक्षा तपासणी आणि पुराव्यावर आधारित पडताळणी केली जाते; पुरेसा पुरावा नसल्यास उत्तर दिले जाणार नाही.",
      gu: "તમારા પ્રશ્નનું મૂલ્યાંકન અધિકૃત આરોગ્ય રેકોર્ડ અને ડિસ્ચાર્જ સૂચનાઓના આધારે થાય છે. દવા-સુરક્ષા તપાસ અને પુરાવા આધારિત ચકાસણી લાગુ પડે છે; પૂરતો પુરાવો ન હોય તો જવાબ આપવામાં નહીં આવે."
    };

    return (
      <>
        <div className="patient-page-intro">
          <span className="patient-eyebrow">PERSONAL HEALTH SUPPORT</span>
          <h2>AI Care Assistant</h2>
          <p>
            Ask questions about your discharge instructions and documented care.
            For emergencies, contact emergency services immediately.
          </p>
        </div>

        <section className="patient-ai-panel">
          <div className="patient-ai-toolbar">
            <label htmlFor="patient-ai-language">Response language</label>
            <select
              id="patient-ai-language"
              value={preferredLanguage}
              onChange={(event) => setPreferredLanguage(event.target.value)}
              disabled={assistantSending}
            >
              {languages.map((item) => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
            </select>
          </div>

          <div className="patient-ai-policy-notice" role="note">
            <span aria-hidden="true">ℹ️</span>
            <div>
              <strong>{policyTitle[preferredLanguage] || policyTitle.en}</strong>
              <p>{policyNotice[preferredLanguage] || policyNotice.en}</p>
            </div>
          </div>

          <section className="patient-ai-suggestions" aria-label={suggestionHeading[preferredLanguage]}>
            <h3>{suggestionHeading[preferredLanguage] || suggestionHeading.en}</h3>
            <div className="patient-ai-suggestion-list">
              {(suggestedQueries[preferredLanguage] || suggestedQueries.en).map((query, index) => (
                <button
                  type="button"
                  key={`${preferredLanguage}-${index}`}
                  className="patient-ai-suggestion-button"
                  disabled={assistantSending}
                  onClick={() => submitAssistantQuestion(query)}
                >
                  <span aria-hidden="true">💬</span>
                  <span>{query}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="patient-ai-messages" aria-live="polite">
            {!assistantMessages.length && (
              <div className="patient-ai-empty">
                <strong>How can we help with your care?</strong>
                <p>
                  Ask about information documented in your discharge or prescription
                  records. The assistant may abstain when reliable evidence is unavailable.
                </p>
              </div>
            )}

            {assistantMessages.map((item) => (
              <article
                key={item.id}
                className={`patient-ai-message ${item.role === "patient" ? "patient-ai-message-user" : "patient-ai-message-assistant"}`}
              >
                <div className="patient-ai-message-label">
                  {item.role === "patient" ? "You" : "Clinical Assistant"}
                  {" · "}
                  {({ en: "English", hi: "Hindi", mr: "Marathi", gu: "Gujarati" })[item.language] || "English"}
                </div>
                <div className="patient-ai-message-content">{renderAssistantMarkdown(item.text)}</div>
                {item.isEmergency && (
                  <strong className="patient-ai-emergency">
                    Emergency detected — contact emergency services immediately.
                  </strong>
                )}
                {!!item.sources?.length && (
                  <div className="patient-ai-sources">
                    <strong>Sources</strong>
                    {item.sources.map((source, index) => (
                      <a
                        key={`${source.url}-${index}`}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {source.title || "Clinical source"}
                      </a>
                    ))}
                  </div>
                )}
              </article>
            ))}

            {assistantSending && (
              <p className="patient-ai-working" role="status">
                Checking the available clinical evidence…
              </p>
            )}
          </div>

          <form className="patient-ai-compose" onSubmit={submitAssistantQuestion}>
            <label htmlFor="patient-ai-question">Your question</label>
            <textarea
              id="patient-ai-question"
              rows={3}
              maxLength={2000}
              required
              value={assistantQuestion}
              onChange={(event) => setAssistantQuestion(event.target.value)}
              placeholder="Ask about your documented care instructions…"
              disabled={assistantSending}
            />
            <div className="patient-ai-compose-footer">
              <span>Do not use this assistant for emergencies.</span>
              <button type="submit" disabled={assistantSending || !assistantQuestion.trim()}>
                {assistantSending ? "Checking…" : "Ask assistant"}
              </button>
            </div>
          </form>
        </section>
      </>
    );
  }

  function renderHistory() {
    return (
      <>
        <div className="patient-page-intro">
          <span className="patient-eyebrow">YOUR HEALTH INFORMATION</span>
          <h2>Medical history</h2>
          <p>Medical-history records associated with your signed-in patient account.</p>
        </div>
        {history.length ? (
          <div className="patient-record-list">
            {history.map((record, index) => (
              <RecordCard key={record.history_id ?? index} record={record} index={index} kind="history" />
            ))}
          </div>
        ) : !loading && !pageError ? (
          <EmptyState symbol="▧" title="No history records available" description="Medical-history entries recorded for your patient profile will appear here." />
        ) : null}
      </>
    );
  }

  function renderChat() {
    return (
      <>
        <div className="patient-page-intro">
          <span className="patient-eyebrow">YOUR CARE TEAM</span>
          <h2>Post-discharge chat</h2>
          <p>Use this space for non-emergency follow-up questions about your discharge and recovery.</p>
        </div>
        <section className="patient-chat-panel">
          <div className="patient-chat-header">
            <div className="patient-chat-avatar">✚</div>
            <div>
              <strong>{contacts.find((contact) => String(contact.user_id) === String(selectedContactId))?.full_name || "Your care team"}</strong>
              <span>{contacts.find((contact) => String(contact.user_id) === String(selectedContactId))?.role === "doctor" ? "Doctor · " + (contacts.find((contact) => String(contact.user_id) === String(selectedContactId))?.detail || "Care team") : "Receptionist · Care coordination"}</span>
            </div>
            <span className="patient-chat-status">Care messages</span>
          </div>
          <div className="patient-chat-recipient">
            <label htmlFor="patient-chat-contact">Send message to</label>
            <select
              id="patient-chat-contact"
              value={selectedContactId}
              onChange={(event) => setSelectedContactId(event.target.value)}
              disabled={!contacts.length}
            >
              {!contacts.length && <option value="">No care-team contacts available</option>}
              {contacts.map((contact) => (
                <option key={contact.user_id} value={String(contact.user_id)}>
                  {contact.full_name} — {contact.role === "doctor" ? `Doctor${contact.detail ? ` · ${contact.detail}` : ""}` : "Receptionist"}
                </option>
              ))}
            </select>
          </div>
          <div className="patient-chat-messages" aria-live="polite">
            {messages.length ? messages.map((item, index) => {
              const mine =
                item.sender_user_id === user.userId ||
                item.senderUserId === user.userId ||
                item.sender_role === "patient" ||
                item.senderRole === "patient";
              return (
                <div className={`patient-chat-row ${mine ? "mine" : "theirs"}`} key={item.message_id ?? item.id ?? index}>
                  <div className="patient-chat-bubble">
                    <p>{item.message || item.body || item.content}</p>
                    <span>{item.created_at ? new Date(item.created_at).toLocaleString() : ""}</span>
                  </div>
                </div>
              );
            }) : (
              <EmptyState symbol="▤" title="Your conversation starts here" description="Messages from your linked care team will appear here when the chat service is connected." />
            )}
          </div>
          <form className="patient-chat-compose" onSubmit={sendMessage}>
            <label className="patient-visually-hidden" htmlFor="patient-chat-message">Write a message to your care team</label>
            <textarea
              id="patient-chat-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Write a follow-up question..."
              rows={2}
              maxLength={3000}
              required
            />
            <button type="submit" disabled={sending || !message.trim()}>
              {sending ? "Sending…" : "Send message ↗"}
            </button>
          </form>
          <p className="patient-chat-disclaimer">This chat is not for emergencies. Seek urgent medical help for emergency symptoms.</p>
        </section>
      </>
    );
  }

  return (
    <div className="patient-app-layout">
      <aside className="patient-sidebar">
        <a className="patient-brand" href="#" onClick={(event) => { event.preventDefault(); selectSection("dashboard"); }}>
          <span className="patient-brand-mark">✚</span>
          <span>CareUnity<small>PATIENT PORTAL</small></span>
        </a>

        <div className="patient-profile-mini">
          <div className="patient-profile-avatar">
            {(user.fullName || "P").trim().charAt(0).toUpperCase()}
          </div>
          <div className="patient-profile-copy">
            <strong>{user.fullName}</strong>
            <span>Patient account</span>
          </div>
          <span className="patient-online-dot" title="Signed in" />
        </div>

        <div className="patient-nav-label">YOUR WORKSPACE</div>
        <nav className="patient-sidebar-nav" aria-label="Patient dashboard">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={`patient-nav-item ${activeSection === item.id ? "active" : ""}`}
              onClick={() => selectSection(item.id)}
              aria-current={activeSection === item.id ? "page" : undefined}
            >
              <span className="patient-nav-symbol">{item.symbol}</span>
              <span>{item.label}</span>
              {activeSection === item.id && <span className="patient-nav-active-mark" />}
            </button>
          ))}
        </nav>

        <div className="patient-sidebar-bottom">
          <div className="patient-help-card">
            <span className="patient-help-symbol">?</span>
            <strong>Need assistance?</strong>
            <p>Contact your healthcare provider for account or care questions.</p>
          </div>
          <button className="patient-logout-button" onClick={onLogout}>
            <span className="patient-nav-symbol">↪</span>
            <span>Logout</span>
          </button>
          <div className="patient-sidebar-footer">CareUnity · Patient portal</div>
        </div>
      </aside>

      <main className="patient-main">
        <header className="patient-topbar">
          <div>
            <div className="patient-breadcrumb">Patient portal <span>/</span> {title}</div>
            <h1>{title}</h1>
          </div>
          <div className="patient-topbar-right">
            <span className="patient-secure-chip"><span /> Secure session</span>
            <div className="patient-topbar-avatar">{(user.fullName || "P").trim().charAt(0).toUpperCase()}</div>
          </div>
        </header>

        <div className="patient-content">
          {pageError && (
            <div className="patient-error-banner" role="alert">
              <span>!</span>
              <div><strong>Unable to load this section</strong><p>{pageError}</p></div>
              <button onClick={() => loadSection(activeSection)}>Retry</button>
            </div>
          )}
          {loading && <div className="patient-loading"><span /> Loading your information…</div>}

          {!pageError && activeSection === "dashboard" && renderDashboard()}
          {activeSection === "care" && renderCare()}
          {activeSection === "chat" && renderChat()}
          {activeSection === "assistant" && renderAssistant()}
          {activeSection === "prescriptions" && renderPrescriptions()}
          {activeSection === "history" && renderHistory()}
        </div>

        <footer className="patient-page-footer">
          <span>CareUnity <span className="patient-footer-dot">•</span> Connected healthcare</span>
          <span>For emergencies, contact local emergency services.</span>
        </footer>
      </main>
    </div>
  );
}

