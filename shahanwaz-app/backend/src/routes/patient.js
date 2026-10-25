const express = require("express");
const { pool } = require("../db");
const { authRequired } = require("../middleware/authMiddleware");

const router = express.Router();
router.use(authRequired);

function patientOnly(req, res, next) {
  if (req.auth?.role !== "patient") {
    return res.status(403).json({
      success: false,
      message: "This endpoint is available to patient accounts only"
    });
  }
  next();
}

router.use(patientOnly);

async function getPatientId(userId) {
  const [rows] = await pool.execute(
    "SELECT patient_id FROM patients WHERE user_id = ? LIMIT 1",
    [userId]
  );

  if (!rows.length) {
    const error = new Error("No patient profile is linked to this account");
    error.code = "PATIENT_PROFILE_MISSING";
    throw error;
  }

  return rows[0].patient_id;
}

async function getColumns(table) {
  const [rows] = await pool.execute(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );

  return rows.map((row) => row.COLUMN_NAME);
}

function safeRecord(record) {
  const output = {};
  for (const [key, value] of Object.entries(record)) {
    if (/password|token|secret|file_data|binary_data|blob_data/i.test(key)) {
      continue;
    }
    if (Buffer.isBuffer(value)) continue;
    output[key] = value;
  }
  return output;
}

async function patientRows(table, patientId) {
  const columns = await getColumns(table);
  if (!columns.length || !columns.includes("patient_id")) return [];

  const preferredOrder = [
    "created_at",
    "discharge_date",
    "discharge_id",
    "prescription_id",
    "history_id",
    "symptom_id",
    "report_id"
  ];

  const orderColumn = preferredOrder.find((name) => columns.includes(name));
  const order = orderColumn ? ` ORDER BY \`${orderColumn}\` DESC` : "";

  const [rows] = await pool.execute(
    `SELECT * FROM \`${table}\` WHERE patient_id = ?${order} LIMIT 100`,
    [patientId]
  );

  return rows.map(safeRecord);
}

async function patientCount(table, patientId) {
  const columns = await getColumns(table);
  if (!columns.length || !columns.includes("patient_id")) return 0;

  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM \`${table}\` WHERE patient_id = ?`,
    [patientId]
  );

  return Number(rows[0].total);
}

async function getPatientContacts(patientId) {
  const [rows] = await pool.execute(
    `SELECT contact.user_id, contact.full_name, contact.role, contact.detail
       FROM (
         SELECT DISTINCT u.user_id, u.full_name, u.role,
                d.specialization AS detail
           FROM doctors d
           JOIN users u ON u.user_id = d.user_id
          WHERE d.doctor_id IN (
            SELECT doctor_id FROM discharges WHERE patient_id = ?
            UNION
            SELECT doctor_id FROM appointments WHERE patient_id = ?
            UNION
            SELECT doctor_id FROM prescriptions WHERE patient_id = ?
          )
         UNION
         SELECT u.user_id, u.full_name, u.role, NULL AS detail
           FROM users u
          WHERE u.role = 'receptionist'
       ) AS contact
      ORDER BY contact.role, contact.full_name`,
    [patientId, patientId, patientId]
  );

  return rows;
}

async function ensureChatTable() {
  const columns = await getColumns("post_discharge_messages");
  if (!columns.length) {
    const error = new Error(
      "Post-discharge chat storage is not installed yet. Create the post_discharge_messages table first."
    );
    error.code = "CHAT_SCHEMA_MISSING";
    throw error;
  }
}

async function attachDoctors(records) {
  const doctorIds = [
    ...new Set(
      records
        .map((record) => Number(record.doctor_id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  ];

  if (!doctorIds.length) return records;

  const placeholders = doctorIds.map(() => "?").join(",");
  const [doctors] = await pool.execute(
    `SELECT d.doctor_id, d.specialization, u.full_name AS doctor_name
       FROM doctors d
       JOIN users u ON u.user_id = d.user_id
      WHERE d.doctor_id IN (${placeholders})`,
    doctorIds
  );

  const byId = new Map(doctors.map((doctor) => [Number(doctor.doctor_id), doctor]));

  return records.map((record) => {
    const doctor = byId.get(Number(record.doctor_id));
    return {
      ...record,
      doctor_name: doctor?.doctor_name || record.doctor_name || null,
      doctor_specialization:
        doctor?.specialization || record.doctor_specialization || null
    };
  });
}

let patientIntakeRequestsTableReady = false;
async function ensurePatientIntakeRequestsTable() {
  if (patientIntakeRequestsTableReady) return;
  // The schema is installed once by an administrator. The application account does not create tables at runtime.
  await pool.query("SELECT 1 FROM patient_intake_requests LIMIT 0");
  patientIntakeRequestsTableReady = true;
}
// Patient dashboard summary and latest discharge records.
router.get("/dashboard", async (req, res) => {
  try {
    const patientId = await getPatientId(req.auth.userId);

    const [
      dischargeCount,
      prescriptionCount,
      historyCount,
      messageCount,
      latestDischarges
    ] = await Promise.all([
      patientCount("discharges", patientId),
      patientCount("prescriptions", patientId),
      patientCount("medical_history", patientId),
      (async () => {
        const columns = await getColumns("post_discharge_messages");
        if (!columns.includes("patient_id")) return 0;
        const [rows] = await pool.execute(
          "SELECT COUNT(*) AS total FROM post_discharge_messages WHERE patient_id = ?",
          [patientId]
        );
        return Number(rows[0].total);
      })(),
      patientRows("discharges", patientId)
    ]);

    res.json({
      success: true,
      summary: {
        dischargeCount,
        prescriptionCount,
        historyCount,
        messageCount
      },
      recentDischarges: await attachDoctors(latestDischarges.slice(0, 3))
    });
  } catch (error) {
    console.error("Patient dashboard error:", error.code || error.message);
    res.status(error.code === "PATIENT_PROFILE_MISSING" ? 404 : 500).json({
      success: false,
      message: error.code === "PATIENT_PROFILE_MISSING"
        ? "Your account does not have a linked patient profile. Contact the administrator."
        : "Unable to load your patient dashboard"
    });
  }
});

// Post-discharge instructions and discharge records.
router.get("/discharges", async (req, res) => {
  try {
    const patientId = await getPatientId(req.auth.userId);
    const records = await patientRows("discharges", patientId);

    res.json({
      success: true,
      discharges: await attachDoctors(records)
    });
  } catch (error) {
    console.error("Patient discharge lookup failed:", error.code || error.message);
    res.status(500).json({
      success: false,
      message: "Unable to load discharge records"
    });
  }
});

// Prescriptions with the associated medicines table where available.
router.get("/prescriptions", async (req, res) => {
  try {
    const patientId = await getPatientId(req.auth.userId);
    const prescriptions = await patientRows("prescriptions", patientId);
    const medicineColumns = await getColumns("prescription_medicines");

    if (
      prescriptions.length &&
      medicineColumns.includes("prescription_id")
    ) {
      const ids = prescriptions
        .map((row) => Number(row.prescription_id))
        .filter((id) => Number.isInteger(id) && id > 0);

      if (ids.length) {
        const placeholders = ids.map(() => "?").join(",");
        const [medicines] = await pool.execute(
          `SELECT * FROM prescription_medicines
            WHERE prescription_id IN (${placeholders})`,
          ids
        );

        const byPrescription = new Map();
        for (const medicine of medicines.map(safeRecord)) {
          const id = Number(medicine.prescription_id);
          if (!byPrescription.has(id)) byPrescription.set(id, []);
          byPrescription.get(id).push(medicine);
        }

        for (const prescription of prescriptions) {
          prescription.medicines =
            byPrescription.get(Number(prescription.prescription_id)) || [];
        }
      }
    }

    res.json({
      success: true,
      prescriptions: await attachDoctors(prescriptions)
    });
  } catch (error) {
    console.error("Patient prescription lookup failed:", error.code || error.message);
    res.status(500).json({
      success: false,
      message: "Unable to load prescriptions"
    });
  }
});

// Medical history includes the history and symptom records for this patient only.
router.get("/medical-history", async (req, res) => {
  try {
    const patientId = await getPatientId(req.auth.userId);
    const [history, symptoms, reports] = await Promise.all([
      patientRows("medical_history", patientId),
      patientRows("symptoms", patientId),
      patientRows("medical_reports", patientId)
    ]);

    const records = [
      ...history.map((row) => ({ ...row, record_source: "Medical history" })),
      ...symptoms.map((row) => ({ ...row, record_source: "Symptoms" })),
      ...reports.map((row) => ({ ...row, record_source: "Medical report" }))
    ];

    res.json({ success: true, records });
  } catch (error) {
    console.error("Patient history lookup failed:", error.code || error.message);
    res.status(500).json({
      success: false,
      message: "Unable to load medical history"
    });
  }
});

// Available doctors connected to the patient's existing care and reception staff.
router.get("/chat/contacts", async (req, res) => {
  try {
    const patientId = await getPatientId(req.auth.userId);
    const contacts = await getPatientContacts(patientId);
    res.json({ success: true, contacts });
  } catch (error) {
    console.error("Patient contact lookup failed:", error.code || error.message);
    res.status(500).json({
      success: false,
      message: "Unable to load care-team contacts"
    });
  }
});

// Load messages for one selected recipient, or all of this patient's threads.
router.get("/chat", async (req, res) => {
  try {
    await ensureChatTable();
    const patientId = await getPatientId(req.auth.userId);
    const contacts = await getPatientContacts(patientId);
    const rawContactId = req.query.contactId;
    let selectedContact = null;

    if (rawContactId) {
      const contactId = Number(rawContactId);
      selectedContact = contacts.find(
        (contact) => Number(contact.user_id) === contactId
      );

      if (!selectedContact) {
        return res.status(403).json({
          success: false,
          message: "That contact is not in your available care team"
        });
      }
    }

    let sql = `
      SELECT m.message_id, m.patient_id, m.sender_user_id,
             m.recipient_user_id, m.message, m.created_at,
             s.full_name AS sender_name, s.role AS sender_role,
             r.full_name AS recipient_name, r.role AS recipient_role
        FROM post_discharge_messages m
        JOIN users s ON s.user_id = m.sender_user_id
        JOIN users r ON r.user_id = m.recipient_user_id
       WHERE m.patient_id = ?`;

    const params = [patientId];

    if (selectedContact) {
      sql += ` AND (
        (m.sender_user_id = ? AND m.recipient_user_id = ?)
        OR
        (m.sender_user_id = ? AND m.recipient_user_id = ?)
      )`;
      params.push(
        req.auth.userId,
        selectedContact.user_id,
        selectedContact.user_id,
        req.auth.userId
      );
    }

    sql += " ORDER BY m.created_at ASC, m.message_id ASC LIMIT 200";

    const [messages] = await pool.execute(sql, params);

    res.json({
      success: true,
      contacts,
      contact: selectedContact,
      messages
    });
  } catch (error) {
    console.error("Patient chat lookup failed:", error.code || error.message);
    res.status(error.code === "CHAT_SCHEMA_MISSING" ? 503 : 500).json({
      success: false,
      message: error.code === "CHAT_SCHEMA_MISSING"
        ? error.message
        : "Unable to load post-discharge messages"
    });
  }
});

// Persist a message to an authorized care-team contact.
router.post("/chat", async (req, res) => {
  try {
    await ensureChatTable();
    const patientId = await getPatientId(req.auth.userId);
    const recipientUserId = Number(req.body.recipientUserId);
    const message =
      typeof req.body.message === "string" ? req.body.message.trim() : "";

    if (!Number.isInteger(recipientUserId) || recipientUserId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Select a doctor or receptionist to message"
      });
    }

    if (!message || message.length > 3000) {
      return res.status(400).json({
        success: false,
        message: "Message must contain 1 to 3000 characters"
      });
    }

    const contacts = await getPatientContacts(patientId);
    const contact = contacts.find(
      (item) => Number(item.user_id) === recipientUserId
    );

    if (!contact) {
      return res.status(403).json({
        success: false,
        message: "You cannot message that account from this patient profile"
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO post_discharge_messages
         (patient_id, sender_user_id, recipient_user_id, message)
       VALUES (?, ?, ?, ?)`,
      [patientId, req.auth.userId, recipientUserId, message]
    );

    res.status(201).json({
      success: true,
      message: "Message sent to your care team",
      messageId: result.insertId
    });
  } catch (error) {
    console.error("Patient chat send failed:", error.code || error.message);
    res.status(error.code === "CHAT_SCHEMA_MISSING" ? 503 : 500).json({
      success: false,
      message: error.code === "CHAT_SCHEMA_MISSING"
        ? error.message
        : "Unable to send your message"
    });
  }
});


// Patient-submitted demographic intake form. It is not itself a confirmed appointment.
router.get("/appointment-requests", async (req, res) => {
  try {
    await ensurePatientIntakeRequestsTable();
    const patientId = await getPatientId(req.auth.userId);
    const [requests] = await pool.execute(
      `SELECT r.request_id, r.patient_id, r.full_name, r.age, r.address, r.phone,
              r.gender, r.blood_group, r.status, r.receptionist_note,
              r.appointment_id, r.created_at, r.reviewed_at,
              DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
              TIME_FORMAT(a.start_time, '%H:%i') AS appointment_start_time,
              TIME_FORMAT(a.end_time, '%H:%i') AS appointment_end_time,
              du.full_name AS doctor_name, d.specialization AS doctor_specialization
         FROM patient_intake_requests r
         LEFT JOIN appointments a ON a.appointment_id = r.appointment_id
         LEFT JOIN doctors d ON d.doctor_id = a.doctor_id
         LEFT JOIN users du ON du.user_id = d.user_id
        WHERE r.patient_id = ?
        ORDER BY r.created_at DESC
        LIMIT 100`,
      [patientId]
    );
    res.json({ success: true, requests });
  } catch (error) {
    console.error("Patient intake lookup failed:", error.code || error.message);
    res.status(500).json({ success: false, message: "Unable to load your submitted details. Please try again or contact reception." });
  }
});

router.post("/appointment-requests", async (req, res) => {
  const fullName = typeof req.body?.fullName === "string" ? req.body.fullName.trim() : "";
  const age = Number(req.body?.age);
  const address = typeof req.body?.address === "string" ? req.body.address.trim() : "";
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const gender = typeof req.body?.gender === "string" ? req.body.gender.trim().toLowerCase() : "";
  const bloodGroup = typeof req.body?.bloodGroup === "string" ? req.body.bloodGroup.trim().toUpperCase() : "";

  if (fullName.length < 2 || fullName.length > 150) {
    return res.status(400).json({ success: false, message: "Enter a name between 2 and 150 characters." });
  }
  if (!Number.isInteger(age) || age < 0 || age > 130) {
    return res.status(400).json({ success: false, message: "Enter a valid age from 0 to 130." });
  }
  if (address.length < 5 || address.length > 500) {
    return res.status(400).json({ success: false, message: "Enter an address between 5 and 500 characters." });
  }
  if (!/^[+\d][\d\s().-]{6,24}$/.test(phone)) {
    return res.status(400).json({ success: false, message: "Enter a valid phone number." });
  }
  if (!["female", "male", "other", "prefer_not_to_say"].includes(gender)) {
    return res.status(400).json({ success: false, message: "Select a valid gender option." });
  }
  if (!["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "UNKNOWN"].includes(bloodGroup)) {
    return res.status(400).json({ success: false, message: "Select a valid blood group." });
  }

  try {
    await ensurePatientIntakeRequestsTable();
    const patientId = await getPatientId(req.auth.userId);
    const [pendingRows] = await pool.execute(
      "SELECT request_id FROM patient_intake_requests WHERE patient_id = ? AND status = 'pending' LIMIT 1",
      [patientId]
    );
    if (pendingRows.length) {
      return res.status(409).json({ success: false, message: "You already have a pending details form. Reception will review it shortly." });
    }
    const [result] = await pool.execute(
      `INSERT INTO patient_intake_requests
         (patient_id, full_name, age, address, phone, gender, blood_group, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [patientId, fullName, age, address, phone, gender, bloodGroup === "UNKNOWN" ? "Unknown" : bloodGroup]
    );
    res.status(201).json({
      success: true,
      requestId: result.insertId,
      message: "Your details have been sent to reception. A receptionist will review them and arrange your appointment."
    });
  } catch (error) {
    console.error("Patient intake submission failed:", error.code || error.message);
    res.status(500).json({ success: false, message: "Unable to send your details to reception. Please try again." });
  }
});
// Patient-only AI assistant. All clinical context is resolved server-side
// from the authenticated patient's own records; the client cannot submit context.
router.post("/assistant", async (req, res) => {
  try {
    const question =
      typeof req.body?.question === "string" ? req.body.question.trim() : "";

    if (!question || question.length > 2000) {
      return res.status(400).json({
        success: false,
        message: "Question must contain between 1 and 2000 characters."
      });
    }

    const language = String(req.body?.language || "en").trim().toLowerCase();
    const supportedLanguages = new Set(["en", "hi", "mr", "gu"]);

    if (!supportedLanguages.has(language)) {
      return res.status(400).json({
        success: false,
        message: "Choose English, Hindi, Marathi, or Gujarati."
      });
    }

    const patientId = await getPatientId(req.auth.userId);

    // The signed-in user's name is used only to redact it from free-text context.
    const [accountRows] = await pool.execute(
      "SELECT full_name FROM users WHERE user_id = ? LIMIT 1",
      [req.auth.userId]
    );
    const patientName = String(accountRows[0]?.full_name || "").trim();

    const redactText = (value) => {
      if (value === null || value === undefined) return "";
      if (typeof value === "object" && !(value instanceof Date)) return "";

      let result = value instanceof Date
        ? value.toISOString().slice(0, 10)
        : String(value);

      result = result
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted]")
        .replace(/\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/g, "[redacted]")
        .replace(/\b\d{12}\b/g, "[redacted]");

      if (patientName.length >= 2) {
        const escaped = patientName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        result = result.replace(new RegExp(escaped, "ig"), "[redacted]");
      }

      return result.trim().slice(0, 1000);
    };

    const rawValue = (record, candidates) => {
      if (!record) return undefined;
      for (const candidate of candidates) {
        const actualKey = Object.keys(record).find(
          key => key.toLowerCase() === candidate.toLowerCase()
        );
        if (actualKey) {
          const value = record[actualKey];
          if (value !== null && value !== undefined && value !== "") {
            return value;
          }
        }
      }
      return undefined;
    };

    const project = (record, definitions) => {
      const result = {};
      for (const [outputKey, candidateKeys] of Object.entries(definitions)) {
        const value = redactText(rawValue(record, candidateKeys));
        if (value) result[outputKey] = value;
      }
      return result;
    };

    const dischargeFields = {
      date: ["discharge_date", "discharged_at"],
      diagnosis: ["discharge_diagnosis", "diagnosis", "primary_diagnosis"],
      summary: ["discharge_summary", "clinical_summary", "summary"],
      instructions: ["discharge_instructions", "aftercare_instructions", "care_instructions", "instructions"],
      medication_instructions: ["medication_instructions", "medication_notes"],
      warning_signs: ["warning_signs", "return_precautions", "red_flags"],
      follow_up: ["follow_up_plan", "follow_up", "followup_instructions"],
      follow_up_date: ["follow_up_date", "followup_date", "next_appointment_date"],
      diet: ["diet_instructions", "dietary_advice"],
      activity: ["activity_instructions", "activity_restrictions"]
    };

    const historyFields = {
      condition: ["condition", "diagnosis", "medical_condition"],
      details: ["history_text", "history", "details", "description"],
      date: ["record_date", "created_at"]
    };

    const symptomFields = {
      symptom: ["symptom", "symptoms", "description"],
      severity: ["severity"],
      duration: ["duration"],
      onset: ["onset", "onset_date"]
    };

    const allergyKeys = [
      "allergy", "allergies", "allergy_name", "allergen", "known_allergies"
    ];

    const medicationFields = {
      name: [
        "medicine_name", "medication_name", "drug_name", "generic_name",
        "medicine", "medication", "drug", "name", "prescription_name"
      ],
      dosage: ["dosage", "dose", "strength", "dose_instructions"],
      frequency: ["frequency", "dose_frequency", "schedule", "times_per_day"],
      duration: ["duration", "duration_days"],
      route: ["route", "administration_route"],
      instructions: ["instructions", "special_instructions", "directions"],
      status: ["status", "medication_status", "prescription_status"]
    };

    const prescriptionFields = {
      date: ["prescription_date", "prescribed_at", "created_at"],
      diagnosis: ["diagnosis", "indication", "reason"],
      status: ["status", "prescription_status"],
      instructions: ["instructions", "prescription_instructions"],
      follow_up: ["follow_up", "follow_up_plan"]
    };

    const [discharges, historyRows, symptomRows, prescriptions] =
      await Promise.all([
        patientRows("discharges", patientId),
        patientRows("medical_history", patientId),
        patientRows("symptoms", patientId),
        patientRows("prescriptions", patientId)
      ]);

    // Only retrieve medicine rows belonging to this patient's prescription IDs.
    const prescriptionIds = prescriptions
      .map(row => Number(row.prescription_id))
      .filter(id => Number.isInteger(id) && id > 0);

    let medicineRows = [];
    const medicineColumns = await getColumns("prescription_medicines");

    if (prescriptionIds.length && medicineColumns.includes("prescription_id")) {
      const placeholders = prescriptionIds.map(() => "?").join(",");
      const [rows] = await pool.execute(
        `SELECT * FROM prescription_medicines
          WHERE prescription_id IN (${placeholders})`,
        prescriptionIds
      );
      medicineRows = rows.map(safeRecord);
    }

    const medicinesByPrescription = new Map();
    for (const row of medicineRows) {
      const id = Number(row.prescription_id);
      if (!medicinesByPrescription.has(id)) {
        medicinesByPrescription.set(id, []);
      }
      const item = project(row, medicationFields);
      if (item.name) medicinesByPrescription.get(id).push(item);
    }

    const prescriptionHistory = prescriptions.slice(0, 30).map(row => {
      const id = Number(row.prescription_id);
      const fromMedicineTable = medicinesByPrescription.get(id) || [];
      const rowMedicine = project(row, medicationFields);
      const medicines = fromMedicineTable.length
        ? fromMedicineTable
        : (rowMedicine.name ? [rowMedicine] : []);

      return {
        ...project(row, prescriptionFields),
        medicines
      };
    });

    // Do not infer that historical prescriptions are still active.
    // Only an explicit active/current status enters active_medications.
    const activeStates = new Set(["active", "current", "ongoing"]);
    const activeMedications = [];

    prescriptions.forEach(row => {
      const status = String(
        rawValue(row, ["status", "prescription_status"]) || ""
      ).trim().toLowerCase();

      if (!activeStates.has(status)) return;

      const id = Number(row.prescription_id);
      const fromMedicineTable = medicinesByPrescription.get(id) || [];
      const rowMedicine = project(row, medicationFields);
      const entries = fromMedicineTable.length
        ? fromMedicineTable
        : (rowMedicine.name ? [rowMedicine] : []);

      activeMedications.push(...entries);
    });

    const safeDischarges = discharges.slice(0, 10)
      .map(row => project(row, dischargeFields))
      .filter(row => Object.keys(row).length);

    const safeHistory = historyRows.slice(0, 30)
      .map(row => project(row, historyFields))
      .filter(row => Object.keys(row).length)
      .map(row => Object.entries(row)
        .map(([key, value]) => `${key}: ${value}`).join("; "));

    const safeSymptoms = symptomRows.slice(0, 20)
      .map(row => project(row, symptomFields))
      .filter(row => Object.keys(row).length)
      .map(row => Object.entries(row)
        .map(([key, value]) => `${key}: ${value}`).join("; "));

    const diagnoses = [
      ...discharges.map(row =>
        redactText(rawValue(row, ["discharge_diagnosis", "diagnosis", "primary_diagnosis"]))
      ),
      ...historyRows.map(row =>
        redactText(rawValue(row, ["condition", "diagnosis", "medical_condition"]))
      )
    ].filter(Boolean);

    const allergies = [
      ...historyRows,
      ...discharges
    ].flatMap(row => allergyKeys.map(key => redactText(rawValue(row, [key]))))
      .filter(Boolean);

    const unique = values => [...new Set(values)].slice(0, 30);

    const patientContext = {
      symptoms: unique(safeSymptoms),
      diagnoses: unique(diagnoses),
      allergies: unique(allergies),
      active_medications: activeMedications.slice(0, 30),
      medical_history: unique(safeHistory),
      discharge_context: {
        discharge_records: safeDischarges,
        prescription_history: prescriptionHistory,
        prescription_status_note:
          "Prescription history can include past orders. Treat medication as current only when its record explicitly indicates active/current status."
      }
    };

    const base = process.env.RAG_API_BASE_URL || "http://127.0.0.1:8000";
    const upstream = await fetch(`${base.replace(/\/$/, "")}/cds/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clinical_query: question,
        mode: "patient",
        language,
        retrieval_mode: "hybrid",
        top_k: 3,
        candidate_medications: [],
        patient_context: patientContext
      })
    });

    const data = await upstream.json().catch(() => ({}));
    console.info("[patient-assistant-cds]", { upstreamBase: base, upstreamStatus: upstream.status, pipelineMode: data.pipeline_mode ?? null, verificationStatus: data.verification_status ?? null, language: data.language ?? language, abstained: data.abstained ?? null });
    console.info("[patient-assistant-cds]", { upstreamBase: base, upstreamStatus: upstream.status, pipelineMode: data.pipeline_mode ?? null, verificationStatus: data.verification_status ?? null, language: data.language ?? language, abstained: data.abstained ?? null });

    if (!upstream.ok) {
      console.error("Patient CDS request failed with status:", upstream.status);
      return res.status(503).json({
        success: false,
        message: "The clinical assistant is temporarily unavailable. Please try again."
      });
    }

    const sources = (Array.isArray(data.citations) ? data.citations : [])
      .filter(item => item && typeof item === "object")
      .map(item => ({
        title: String(item.title || item.source_name || "Clinical source"),
        url: typeof item.url === "string" ? item.url : "",
        publisher: String(item.publisher || item.source_name || "Medical source")
      }))
      .filter(item => /^https?:\/\//i.test(item.url))
      .filter((item, index, all) =>
        all.findIndex(other => other.url === item.url) === index
      )
      .slice(0, 5);

    res.json({
      success: true,
      answer: String(data.answer || ""),
      sources,
      language: data.language || language,
      detected_language: data.detected_language || null,
      verification_status: data.verification_status || "unknown",
      is_grounded: Boolean(data.is_grounded),
      is_emergency: Boolean(data.is_emergency),
      abstained: Boolean(data.abstained),
      abstention_reason: data.abstention_reason || null,
      safety_alerts: Array.isArray(data.safety_alerts) ? data.safety_alerts : []
    });
  } catch (error) {
    console.error("Patient assistant failed:", error.code || error.message);
    res.status(error.code === "PATIENT_PROFILE_MISSING" ? 404 : 503).json({
      success: false,
      message: error.code === "PATIENT_PROFILE_MISSING"
        ? "Your account does not have a linked patient profile."
        : "Unable to process the clinical question right now."
    });
  }
});


module.exports = router;
