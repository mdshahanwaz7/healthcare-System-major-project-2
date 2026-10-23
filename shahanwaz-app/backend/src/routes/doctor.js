const express = require("express");
const { pool } = require("../db");
const { authRequired } = require("../middleware/authMiddleware");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const router = express.Router();
const uploadsDir = path.join(__dirname, "..", "..", "uploads", "prescription-ocr");
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadsDir),
    filename: (_req, file, callback) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      callback(null, `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.mimetype)) {
      return callback(new Error("Upload a JPEG, PNG, WEBP or PDF file."));
    }
    callback(null, true);
  }
});

const aliases = {
  patientId: ["patient_id"],
  doctorId: ["doctor_id"],
  diagnosis: ["diagnosis", "diagnosis_summary", "primary_diagnosis", "condition"],
  notes: ["notes", "doctor_notes", "clinical_notes", "remarks"],
  prescriptionDate: ["prescription_date", "prescribed_at", "date_prescribed", "created_at"],
  prescriptionId: ["prescription_id"],
  medicineName: ["medicine_name", "medication_name", "drug_name", "name", "medicine"],
  dosage: ["dosage", "dose", "strength"],
  frequency: ["frequency", "dose_frequency"],
  duration: ["duration", "duration_days"],
  quantity: ["quantity", "qty"],
  medicineInstructions: ["instructions", "directions", "medicine_instructions", "notes"],
  routeOfAdministration: ["route", "administration_route"],
  dischargeDate: ["discharge_date", "date_of_discharge", "discharged_at", "created_at"],
  treatmentSummary: ["treatment_summary", "summary", "hospital_course", "treatment_notes"],
  dischargeInstructions: ["discharge_instructions", "aftercare_instructions", "instructions", "notes"],
  warningSigns: ["warning_signs", "warning_signs_to_watch_for", "red_flags"],
  medicationsText: ["medications", "medication_list", "discharge_medications"],
  followUpDate: ["follow_up_date", "followup_date", "followup_on"],
  followUpInstructions: ["follow_up_instructions", "followup_instructions"],
  dayOfWeek: ["day_of_week"],
  startTime: ["start_time"],
  endTime: ["end_time"],
  activityType: ["activity_type"],
  location: ["location"],
  available: ["available"],
  scheduleNotes: ["notes"],
  fileName: ["original_filename", "original_file_name", "file_name", "filename", "source_filename"],
  filePath: ["file_path", "upload_path", "document_path", "image_path", "file_location", "source_file_path"],
  mimeType: ["mime_type", "content_type", "file_type"],
  ocrResult: ["ocr_result", "extracted_text", "recognized_text", "result_text"],
  createdAt: ["created_at", "uploaded_at", "submitted_at"]
};

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function tableMeta(table, executor = pool) {
  const [rows] = await executor.execute(
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE,
            COLUMN_DEFAULT, EXTRA
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [table]
  );
  if (!rows.length) throw httpError(503, `Database table '${table}' is not available.`);
  return rows;
}

function enumOptions(columnType) {
  if (!/^enum\(/i.test(columnType || "")) return [];
  return [...columnType.matchAll(/'((?:\\.|[^'])*)'/g)].map((match) =>
    match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\")
  );
}

function normaliseEnum(column, value, tableName) {
  const options = enumOptions(column.COLUMN_TYPE);
  if (!options.length || value == null) return value;
  if (options.includes(String(value))) return value;

  const fieldName = column.COLUMN_NAME.toLowerCase();
  if (fieldName === "status") {
    const preferences = tableName === "prescription_ocr_jobs"
      ? ["pending", "uploaded", "queued", "submitted", "processing"]
      : ["scheduled", "active", "pending", "created"];
    return preferences.find((candidate) => options.includes(candidate)) || options[0];
  }

  const match = options.find((candidate) =>
    candidate.toLowerCase() === String(value).toLowerCase()
  );
  return match ?? value;
}

async function insertMapped(connection, table, fields) {
  const meta = await tableMeta(table, connection);
  const columns = new Map(meta.map((column) => [column.COLUMN_NAME, column]));
  const output = new Map();

  for (const [logicalName, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const candidates = aliases[logicalName] || [logicalName];
    const columnName = candidates.find((candidate) => columns.has(candidate));
    if (!columnName) continue;

    const column = columns.get(columnName);
    output.set(columnName, normaliseEnum(column, value, table));
  }

  const missing = meta.filter((column) =>
    column.IS_NULLABLE === "NO" &&
    column.COLUMN_DEFAULT === null &&
    !String(column.EXTRA || "").includes("auto_increment") &&
    !String(column.EXTRA || "").includes("GENERATED") &&
    !output.has(column.COLUMN_NAME)
  );

  if (missing.length) {
    throw httpError(
      422,
      `The existing ${table} schema requires additional fields not mapped by this endpoint: ${missing.map((item) => item.COLUMN_NAME).join(", ")}. Inspect the schema before saving.`
    );
  }

  if (!output.size) throw httpError(422, `No compatible fields could be mapped into ${table}.`);

  const names = [...output.keys()];
  const placeholders = names.map(() => "?").join(", ");
  const sql = `INSERT INTO \`${table}\` (${names.map((name) => `\`${name}\``).join(", ")}) VALUES (${placeholders})`;
  const params = names.map((name) => output.get(name));
  const [result] = await connection.execute(sql, params);
  return { insertId: result.insertId, affectedRows: result.affectedRows };
}

async function primaryKey(table) {
  const [rows] = await pool.execute(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = 'PRIMARY'
      ORDER BY ORDINAL_POSITION
      LIMIT 1`,
    [table]
  );
  if (!rows.length) throw httpError(503, `No primary key is configured for ${table}.`);
  return rows[0].COLUMN_NAME;
}

async function getDoctorId(userId) {
  const [rows] = await pool.execute(
    `SELECT d.doctor_id, d.user_id, d.specialization, d.qualification,
            d.license_number, d.experience_years, d.bio,
            u.full_name, u.email, u.phone
       FROM doctors d
       JOIN users u ON u.user_id = d.user_id
      WHERE d.user_id = ? AND u.role = 'doctor'
      LIMIT 1`,
    [userId]
  );

  if (!rows.length) throw httpError(403, "A verified doctor profile is required for this feature.");
  return rows[0];
}

router.use(authRequired, async (req, res, next) => {
  if (req.auth?.role !== "doctor") {
    return res.status(403).json({
      success: false,
      message: "Doctor access is required."
    });
  }

  try {
    req.doctorProfile = await getDoctorId(req.auth.userId);
    req.doctorId = req.doctorProfile.doctor_id;
    next();
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Unable to load the doctor profile."
    });
  }
});

async function linkedPatient(connection, doctorId, patientId) {
  const [rows] = await connection.execute(
    `SELECT patient_id FROM (
       SELECT patient_id FROM appointments WHERE doctor_id = ?
       UNION SELECT patient_id FROM discharges WHERE doctor_id = ?
       UNION SELECT patient_id FROM prescriptions WHERE doctor_id = ?
     ) AS linked
     WHERE patient_id = ?
     LIMIT 1`,
    [doctorId, doctorId, doctorId, patientId]
  );
  return rows.length > 0;
}

async function doctorPatientRows(doctorId) {
  const [rows] = await pool.execute(
    `SELECT p.patient_id, p.user_id, u.full_name, u.email, u.phone,
            p.date_of_birth, p.gender, p.blood_group, p.allergies,
            p.address, p.emergency_contact
       FROM patients p
       JOIN users u ON u.user_id = p.user_id
      WHERE p.patient_id IN (
        SELECT patient_id FROM appointments WHERE doctor_id = ?
        UNION SELECT patient_id FROM discharges WHERE doctor_id = ?
        UNION SELECT patient_id FROM prescriptions WHERE doctor_id = ?
      )
      ORDER BY u.full_name
      LIMIT 500`,
    [doctorId, doctorId, doctorId]
  );
  return rows;
}

router.get("/overview", async (req, res) => {
  try {
    const doctorId = req.doctorId;
    const [patientRows, appointmentRows, prescriptionRows, dischargeRows, upcoming] =
      await Promise.all([
        pool.execute(
          `SELECT COUNT(*) AS total FROM (
             SELECT patient_id FROM appointments WHERE doctor_id = ?
             UNION SELECT patient_id FROM discharges WHERE doctor_id = ?
             UNION SELECT patient_id FROM prescriptions WHERE doctor_id = ?
           ) AS linked`,
          [doctorId, doctorId, doctorId]
        ),
        pool.execute(
          `SELECT COUNT(*) AS total,
                  COALESCE(SUM(status = 'scheduled'), 0) AS scheduled_count
             FROM appointments WHERE doctor_id = ?`,
          [doctorId]
        ),
        pool.execute(
          "SELECT COUNT(*) AS total FROM prescriptions WHERE doctor_id = ?",
          [doctorId]
        ),
        pool.execute(
          "SELECT COUNT(*) AS total FROM discharges WHERE doctor_id = ?",
          [doctorId]
        ),
        pool.execute(
          `SELECT a.appointment_id, a.patient_id, a.appointment_date,
                  a.start_time, a.end_time, a.reason, a.status,
                  u.full_name AS patient_name
             FROM appointments a
             JOIN patients p ON p.patient_id = a.patient_id
             JOIN users u ON u.user_id = p.user_id
            WHERE a.doctor_id = ? AND a.appointment_date >= CURRENT_DATE
              AND a.status = 'scheduled'
            ORDER BY a.appointment_date, a.start_time LIMIT 5`,
          [doctorId]
        )
      ]);

    res.json({
      success: true,
      doctor: req.doctorProfile,
      summary: {
        patients: Number(patientRows[0][0].total),
        appointments: Number(appointmentRows[0][0].total),
        scheduledAppointments: Number(appointmentRows[0][0].scheduled_count),
        prescriptions: Number(prescriptionRows[0][0].total),
        discharges: Number(dischargeRows[0][0].total)
      },
      upcomingAppointments: upcoming[0]
    });
  } catch (error) {
    console.error("Doctor overview failed:", error.code || error.message);
    res.status(500).json({ success: false, message: "Unable to load the doctor overview." });
  }
});

router.get("/patients", async (req, res) => {
  try {
    res.json({ success: true, patients: await doctorPatientRows(req.doctorId) });
  } catch (error) {
    console.error("Doctor patient lookup failed:", error.code || error.message);
    res.status(500).json({ success: false, message: "Unable to load your linked patients." });
  }
});

router.get("/appointments", async (req, res) => {
  try {
    const status = String(req.query.status || "all").toLowerCase();
    if (!["all", "scheduled", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid appointment status." });
    }

    let sql = `SELECT a.appointment_id, a.doctor_id, a.patient_id,
                      a.appointment_date, a.start_time, a.end_time,
                      a.reason, a.status, u.full_name AS patient_name,
                      u.email AS patient_email, u.phone AS patient_phone
                 FROM appointments a
                 JOIN patients p ON p.patient_id = a.patient_id
                 JOIN users u ON u.user_id = p.user_id
                WHERE a.doctor_id = ?`;
    const params = [req.doctorId];
    if (status !== "all") {
      sql += " AND a.status = ?";
      params.push(status);
    }
    sql += " ORDER BY a.appointment_date DESC, a.start_time DESC LIMIT 500";

    const [appointments] = await pool.execute(sql, params);
    res.json({ success: true, appointments });
  } catch (error) {
    console.error("Doctor appointment list failed:", error.code || error.message);
    res.status(500).json({ success: false, message: "Unable to load your appointments." });
  }
});

router.patch("/appointments/:id/status", async (req, res) => {
  const appointmentId = Number(req.params.id);
  const status = String(req.body.status || "").toLowerCase();
  if (!Number.isInteger(appointmentId) || appointmentId <= 0 ||
      !["completed", "cancelled"].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Provide a valid appointment ID and a completed or cancelled status."
    });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE appointments SET status = ?
        WHERE appointment_id = ? AND doctor_id = ? AND status = 'scheduled'`,
      [status, appointmentId, req.doctorId]
    );

    if (!result.affectedRows) {
      return res.status(409).json({
        success: false,
        message: "Appointment not found, not assigned to you, or no longer scheduled."
      });
    }

    res.json({ success: true, message: `Appointment marked ${status}.` });
  } catch (error) {
    console.error("Doctor appointment update failed:", error.code || error.message);
    res.status(500).json({ success: false, message: "Unable to update the appointment." });
  }
});

router.get("/schedule/options", async (_req, res) => {
  try {
    const meta = await tableMeta("doctor_schedule");
    const dayColumn = meta.find((column) => column.COLUMN_NAME === "day_of_week");
    const activityColumn = meta.find((column) => column.COLUMN_NAME === "activity_type");
    const dataDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    let days = dataDays.map((label, index) => ({ label, value: label }));
    if (dayColumn && ["tinyint", "smallint", "mediumint", "int", "bigint"].includes(dayColumn.DATA_TYPE)) {
      days = dataDays.map((label, index) => ({ label, value: index }));
    } else if (dayColumn && enumOptions(dayColumn.COLUMN_TYPE).length) {
      days = enumOptions(dayColumn.COLUMN_TYPE).map((value) => ({ label: value, value }));
    }

    const activityTypes = activityColumn && enumOptions(activityColumn.COLUMN_TYPE).length
      ? enumOptions(activityColumn.COLUMN_TYPE)
      : ["Clinic", "Consultation", "Procedure", "Break"];

    res.json({ success: true, days, activityTypes });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to load schedule options."
    });
  }
});

router.get("/schedule", async (req, res) => {
  try {
    const key = await primaryKey("doctor_schedule");
    const [schedule] = await pool.execute(
      `SELECT * FROM doctor_schedule WHERE doctor_id = ? ORDER BY day_of_week, start_time`,
      [req.doctorId]
    );
    res.json({
      success: true,
      schedule: schedule.map((item) => ({ ...item, scheduleId: item[key] }))
    });
  } catch (error) {
    console.error("Doctor schedule list failed:", error.code || error.message);
    res.status(500).json({ success: false, message: "Unable to load your schedule." });
  }
});

router.post("/schedule", async (req, res) => {
  const dayOfWeek = req.body.dayOfWeek;
  const startTime = String(req.body.startTime || "");
  const endTime = String(req.body.endTime || "");
  const activityType = String(req.body.activityType || "").trim();
  const location = typeof req.body.location === "string" ? req.body.location.trim() : "";
  const notes = typeof req.body.notes === "string" ? req.body.notes.trim() : "";
  const available = req.body.available === false ? 0 : 1;

  if (dayOfWeek === undefined || dayOfWeek === "" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) ||
      endTime <= startTime || !activityType) {
    return res.status(400).json({
      success: false,
      message: "Select a day, activity and valid start/end times."
    });
  }

  if (location.length > 255 || notes.length > 2000) {
    return res.status(400).json({ success: false, message: "Location or notes are too long." });
  }

  try {
    const meta = await tableMeta("doctor_schedule");
    const dayColumn = meta.find((column) => column.COLUMN_NAME === "day_of_week");
    let dayValue = dayOfWeek;
    if (dayColumn && ["tinyint", "smallint", "mediumint", "int", "bigint"].includes(dayColumn.DATA_TYPE)) {
      dayValue = Number(dayOfWeek);
      if (!Number.isInteger(dayValue) || dayValue < 0 || dayValue > 6) {
        return res.status(400).json({ success: false, message: "Invalid day of week." });
      }
    } else if (dayColumn && enumOptions(dayColumn.COLUMN_TYPE).length) {
      const valid = enumOptions(dayColumn.COLUMN_TYPE);
      dayValue = valid.find((item) => item.toLowerCase() === String(dayOfWeek).toLowerCase());
      if (!dayValue) return res.status(400).json({ success: false, message: "Invalid day of week." });
    }

    const result = await insertMapped(pool, "doctor_schedule", {
      doctorId: req.doctorId,
      dayOfWeek: dayValue,
      startTime: `${startTime}:00`,
      endTime: `${endTime}:00`,
      activityType,
      location: location || null,
      scheduleNotes: notes || null,
      available
    });

    res.status(201).json({ success: true, message: "Schedule entry created.", scheduleId: result.insertId });
  } catch (error) {
    console.error("Doctor schedule create failed:", error.code || error.message);
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Unable to create your schedule entry."
    });
  }
});

router.patch("/schedule/:id", async (req, res) => {
  const scheduleEntryId = Number(req.params.id);
  if (!Number.isInteger(scheduleEntryId) || scheduleEntryId <= 0) {
    return res.status(400).json({ success: false, message: "Invalid schedule ID." });
  }

  try {
    const key = await primaryKey("doctor_schedule");
    const meta = await tableMeta("doctor_schedule");
    const allowed = new Map(meta.map((column) => [column.COLUMN_NAME, column]));
    const updates = [];

    if (typeof req.body.available === "boolean" && allowed.has("available")) {
      updates.push({ column: "available", value: req.body.available ? 1 : 0 });
    }
    if (typeof req.body.location === "string" && allowed.has("location")) {
      updates.push({ column: "location", value: req.body.location.trim() || null });
    }
    if (typeof req.body.notes === "string" && allowed.has("notes")) {
      updates.push({ column: "notes", value: req.body.notes.trim() || null });
    }

    if (!updates.length) {
      return res.status(400).json({ success: false, message: "No supported schedule changes were supplied." });
    }

    const setSql = updates.map((item) => `\`${item.column}\` = ?`).join(", ");
    const params = updates.map((item) => item.value);
    params.push(scheduleEntryId, req.doctorId);

    const [result] = await pool.execute(
      `UPDATE doctor_schedule SET ${setSql} WHERE \`${key}\` = ? AND doctor_id = ?`,
      params
    );

    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: "Schedule entry not found for your account." });
    }

    res.json({ success: true, message: "Schedule updated." });
  } catch (error) {
    console.error("Doctor schedule update failed:", error.code || error.message);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to update the schedule." });
  }
});

router.delete("/schedule/:id", async (req, res) => {
  const scheduleEntryId = Number(req.params.id);
  if (!Number.isInteger(scheduleEntryId) || scheduleEntryId <= 0) {
    return res.status(400).json({ success: false, message: "Invalid schedule ID." });
  }

  try {
    const key = await primaryKey("doctor_schedule");
    const [result] = await pool.execute(
      `DELETE FROM doctor_schedule WHERE \`${key}\` = ? AND doctor_id = ?`,
      [scheduleEntryId, req.doctorId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: "Schedule entry not found for your account." });
    }

    res.json({ success: true, message: "Schedule entry deleted." });
  } catch (error) {
    console.error("Doctor schedule delete failed:", error.code || error.message);
    res.status(error.status || 500).json({ success: false, message: error.message || "Unable to delete the schedule entry." });
  }
});

router.get("/prescriptions", async (req, res) => {
  try {
    const [prescriptions] = await pool.execute(
      `SELECT pr.*, pu.full_name AS patient_name, pu.email AS patient_email
         FROM prescriptions pr
         JOIN patients p ON p.patient_id = pr.patient_id
         JOIN users pu ON pu.user_id = p.user_id
        WHERE pr.doctor_id = ?
        ORDER BY pr.prescription_id DESC
        LIMIT 300`,
      [req.doctorId]
    );

    const ids = prescriptions
      .map((row) => Number(row.prescription_id))
      .filter((id) => Number.isInteger(id) && id > 0);
    let groupedMedicines = new Map();

    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      const [medicines] = await pool.execute(
        `SELECT * FROM prescription_medicines WHERE prescription_id IN (${placeholders})`,
        ids
      );
      for (const medicine of medicines) {
        const id = Number(medicine.prescription_id);
        if (!groupedMedicines.has(id)) groupedMedicines.set(id, []);
        groupedMedicines.get(id).push(medicine);
      }
    }

    res.json({
      success: true,
      prescriptions: prescriptions.map((item) => ({
        ...item,
        medicines: groupedMedicines.get(Number(item.prescription_id)) || []
      }))
    });
  } catch (error) {
    console.error("Doctor prescription lookup failed:", error.code || error.message);
    res.status(500).json({ success: false, message: "Unable to load prescriptions." });
  }
});

router.post("/prescriptions", async (req, res) => {
  const patientId = Number(req.body.patientId);
  const diagnosis = typeof req.body.diagnosis === "string" ? req.body.diagnosis.trim() : "";
  const notes = typeof req.body.notes === "string" ? req.body.notes.trim() : "";
  const medicines = Array.isArray(req.body.medicines) ? req.body.medicines : [];

  if (!Number.isInteger(patientId) || patientId <= 0 || !diagnosis) {
    return res.status(400).json({ success: false, message: "Select a patient and enter a diagnosis." });
  }
  if (diagnosis.length > 3000 || notes.length > 5000 || medicines.length > 30) {
    return res.status(400).json({ success: false, message: "Prescription form exceeds permitted limits." });
  }

  for (const medicine of medicines) {
    if (!medicine || typeof medicine.name !== "string" || !medicine.name.trim() ||
        String(medicine.name).length > 200) {
      return res.status(400).json({ success: false, message: "Each medicine needs a valid name." });
    }
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    if (!(await linkedPatient(connection, req.doctorId, patientId))) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "You can only prescribe for a patient linked to your care through an appointment, discharge or existing prescription."
      });
    }

    const prescriptionResult = await insertMapped(connection, "prescriptions", {
      doctorId: req.doctorId,
      patientId,
      diagnosis,
      notes: notes || null,
      prescriptionDate: new Date()
    });

    const prescriptionId = prescriptionResult.insertId;

    for (const medicine of medicines) {
      await insertMapped(connection, "prescription_medicines", {
        prescriptionId,
        medicineName: medicine.name.trim(),
        dosage: typeof medicine.dosage === "string" ? medicine.dosage.trim() || null : null,
        frequency: typeof medicine.frequency === "string" ? medicine.frequency.trim() || null : null,
        duration: typeof medicine.duration === "string" ? medicine.duration.trim() || null : null,
        quantity: medicine.quantity ?? undefined,
        routeOfAdministration: typeof medicine.route === "string" ? medicine.route.trim() || null : null,
        medicineInstructions: typeof medicine.instructions === "string" ? medicine.instructions.trim() || null : null
      });
    }

    await connection.commit();
    res.status(201).json({ success: true, message: "Prescription saved.", prescriptionId });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Prescription create failed:", error.code || error.message);
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Unable to save the prescription. Check the existing prescription table columns."
    });
  } finally {
    if (connection) connection.release();
  }
});

router.get("/discharge-care", async (req, res) => {
  try {
    const [records] = await pool.execute(
      `SELECT dc.*, u.full_name AS patient_name, u.email AS patient_email
         FROM discharges dc
         JOIN patients p ON p.patient_id = dc.patient_id
         JOIN users u ON u.user_id = p.user_id
        WHERE dc.doctor_id = ?
        ORDER BY dc.discharge_id DESC
        LIMIT 300`,
      [req.doctorId]
    );
    res.json({ success: true, discharges: records });
  } catch (error) {
    console.error("Doctor discharge list failed:", error.code || error.message);
    res.status(500).json({ success: false, message: "Unable to load discharge care records." });
  }
});

router.post("/discharge-care", async (req, res) => {
  const patientId = Number(req.body.patientId);
  const diagnosis = typeof req.body.diagnosis === "string" ? req.body.diagnosis.trim() : "";
  const treatmentSummary = typeof req.body.treatmentSummary === "string" ? req.body.treatmentSummary.trim() : "";
  const instructions = typeof req.body.instructions === "string" ? req.body.instructions.trim() : "";
  const warningSigns = typeof req.body.warningSigns === "string" ? req.body.warningSigns.trim() : "";
  const medicationsText = typeof req.body.medications === "string" ? req.body.medications.trim() : "";
  const dischargeDate = typeof req.body.dischargeDate === "string" ? req.body.dischargeDate : new Date().toISOString().slice(0, 10);
  const followUpDate = typeof req.body.followUpDate === "string" && req.body.followUpDate
    ? req.body.followUpDate
    : undefined;

  if (!Number.isInteger(patientId) || patientId <= 0 || !diagnosis || !instructions || !warningSigns) {
    return res.status(400).json({
      success: false,
      message: "Select a linked patient, enter a diagnosis, provide discharge instructions and warning signs."
    });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    if (!(await linkedPatient(connection, req.doctorId, patientId))) {
      await connection.rollback();
      return res.status(403).json({ success: false, message: "This patient is not linked to your care." });
    }

    const result = await insertMapped(connection, "discharges", {
      doctorId: req.doctorId,
      patientId,
      diagnosis,
      treatmentSummary: treatmentSummary || null,
      dischargeInstructions: instructions,
      warningSigns: warningSigns,
      medicationsText: medicationsText || null,
      dischargeDate,
      followUpDate,
      notes: instructions
    });

    await connection.commit();
    res.status(201).json({ success: true, message: "Discharge care record saved.", dischargeId: result.insertId });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Doctor discharge record create failed:", error.code || error.message);
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Unable to save the discharge care record. Check the existing discharge table columns."
    });
  } finally {
    if (connection) connection.release();
  }
});

router.put("/profile", async (req, res) => {
  const fullName = typeof req.body.fullName === "string" ? req.body.fullName.trim() : "";
  const phone = typeof req.body.phone === "string" ? req.body.phone.trim() : "";
  const specialization = typeof req.body.specialization === "string" ? req.body.specialization.trim() : "";
  const qualification = typeof req.body.qualification === "string" ? req.body.qualification.trim() : "";
  const licenseNumber = typeof req.body.licenseNumber === "string" ? req.body.licenseNumber.trim() : "";
  const bio = typeof req.body.bio === "string" ? req.body.bio.trim() : "";
  const experience = req.body.experienceYears === "" || req.body.experienceYears == null
    ? null : Number(req.body.experienceYears);

  if (!fullName || fullName.length > 100 || phone.length > 20 ||
      specialization.length > 150 || qualification.length > 150 ||
      licenseNumber.length > 100 || bio.length > 5000 ||
      (experience !== null && (!Number.isInteger(experience) || experience < 0 || experience > 80))) {
    return res.status(400).json({ success: false, message: "Check the values in your profile form." });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await connection.execute(
      "UPDATE users SET full_name = ?, phone = ? WHERE user_id = ? AND role = 'doctor'",
      [fullName, phone || null, req.auth.userId]
    );
    await connection.execute(
      `UPDATE doctors
          SET specialization = ?, qualification = ?, license_number = ?,
              experience_years = ?, bio = ?
        WHERE doctor_id = ?`,
      [specialization || null, qualification || null, licenseNumber || null, experience, bio || null, req.doctorId]
    );
    await connection.commit();
    res.json({ success: true, message: "Doctor profile updated." });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Doctor profile update failed:", error.code || error.message);
    res.status(500).json({
      success: false,
      message: "Unable to update your profile. Check that professional license details remain unique."
    });
  } finally {
    if (connection) connection.release();
  }
});

router.get("/profile", async (req, res) => {
  res.json({ success: true, profile: req.doctorProfile });
});

router.post("/clinical-assistant", async (req, res) => {
  const question = typeof req.body.question === "string"
    ? req.body.question.trim()
    : "";

  if (!question || question.length > 5000) {
    return res.status(400).json({
      success: false,
      message: "Enter a clinical question up to 5000 characters."
    });
  }

  try {
    const base = process.env.RAG_API_BASE_URL || "http://127.0.0.1:8000";

    // Use the existing CDS gateway rather than retrieval-only /rag/query.
    // Patient-specific context is intentionally not accepted from the browser.
    const upstream = await fetch(`${base.replace(/\/$/, "")}/cds/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clinical_query: question,
        mode: "doctor",
        retrieval_mode: "hybrid",
        language: "en",
        candidate_medications: []
      }),
      signal: AbortSignal.timeout(300000)
    });

    const data = await upstream.json().catch(() => null);

    if (!upstream.ok || !data || typeof data !== "object") {
      console.error("CDS evaluation failed with HTTP", upstream.status);
      return res.status(502).json({
        success: false,
        message: "The clinical decision support service could not complete this request. Please try again."
      });
    }

    if (typeof data.answer !== "string" || !data.answer.trim()) {
      return res.status(502).json({
        success: false,
        message: "The clinical decision support service returned no answer."
      });
    }

    const sourceRows = (Array.isArray(data.citations) ? data.citations : [])
      .filter(item => item && typeof item === "object")
      .map(item => ({
        title: String(item.title || item.source_name || item.publisher || "Clinical source"),
        url: typeof item.url === "string" ? item.url : "",
        publisher: String(item.publisher || item.source_name || "Medical source")
      }))
      .filter(item => /^https?:\/\//i.test(item.url))
      .filter((item, index, all) =>
        all.findIndex(other => other.url === item.url) === index
      );

    // Prefer source titles that match a specific medicine named in the query.
    // This only filters displayed links; it does not alter CDS verification.
    const citationStopWords = new Set([
      "what", "which", "when", "where", "why", "how", "does", "are",
      "the", "with", "from", "into", "for", "about", "please", "tell",
      "show", "important", "major", "common", "fictional", "drug", "drugs",
      "medication", "medications", "medicine", "medicines", "interaction",
      "interactions", "interact", "contraindication", "contraindications",
      "side", "effects", "adverse", "reaction", "reactions", "symptoms",
      "used", "uses", "using", "dose", "dosage", "treatment", "clinical",
      "patient", "patients", "between", "during", "after", "before",
      "taking", "information", "risk", "risks", "can", "could", "should",
      "would", "and", "that", "this", "their", "list", "explain", "kidney",
      "renal", "impairment", "disease", "liver", "hepatic", "failure",
      "pregnancy", "pregnant", "alcohol", "blood", "pressure", "heart",
      "diabetes", "type", "management", "control"
    ]);

    const querySpecificTerms = [...new Set(
      (String(question || "").toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || [])
        .filter(term => !citationStopWords.has(term))
    )];

    const matchedQueryTerms = querySpecificTerms.filter(term =>
      sourceRows.some(item => item.title.toLowerCase().includes(term))
    );

    const relevantSourceRows = querySpecificTerms.length
      ? (matchedQueryTerms.length
          ? sourceRows.filter(item =>
              matchedQueryTerms.some(term => item.title.toLowerCase().includes(term))
            )
          : [])
      : sourceRows;

    res.json({
      success: true,
      answer: data.answer,
      sources: relevantSourceRows.slice(0, 5),
      disclaimer: data.is_emergency
        ? ""
        : "Clinical decision support only. Verify against the patient's chart, original sources, and local protocols.",
      verification_status: data.verification_status || "unknown",
      is_grounded: Boolean(data.is_grounded),
      abstained: Boolean(data.abstained),
      is_emergency: Boolean(data.is_emergency),
      abstention_reason: data.abstention_reason || null,
      safety_alerts: Array.isArray(data.safety_alerts) ? data.safety_alerts : [],
      drug_interactions: Array.isArray(data.drug_interactions) ? data.drug_interactions : [],
      retrieved_chunks_count: Number(data.retrieved_chunks_count || 0),
      pipeline_mode: data.pipeline_mode || "hybrid"
    });
  } catch (error) {
    console.error("CDS request failed:", error.name || "RequestError");
    res.status(503).json({
      success: false,
      message: "The clinical decision support service is unavailable. Check the RAG API on port 8000."
    });
  }
});

router.get("/ocr", async (req, res) => {
  try {
    const [jobs] = await pool.execute(
      `SELECT j.*, u.full_name AS patient_name
         FROM prescription_ocr_jobs j
         LEFT JOIN patients p ON p.patient_id = j.patient_id
         LEFT JOIN users u ON u.user_id = p.user_id
        WHERE j.doctor_id = ?
        ORDER BY j.created_at DESC
        LIMIT 200`,
      [req.doctorId]
    );
    res.json({ success: true, jobs });
  } catch (error) {
    console.error("Doctor OCR job list failed:", error.code || error.message);
    res.status(500).json({ success: false, message: "Unable to load OCR jobs." });
  }
});

router.post("/ocr", (req, res, next) => {
  upload.single("file")(req, res, (error) => {
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message || "File upload failed. Allowed formats are JPEG, PNG, WEBP and PDF (maximum 10 MB)."
      });
    }
    next();
  });
}, async (req, res) => {
  const patientId = Number(req.body.patientId);
  if (!req.file) {
    return res.status(400).json({ success: false, message: "Select a prescription file to upload." });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    if (!Number.isInteger(patientId) || patientId <= 0 ||
        !(await linkedPatient(connection, req.doctorId, patientId))) {
      await connection.rollback();
      fs.unlink(req.file.path, () => {});
      return res.status(403).json({
        success: false,
        message: "Select a patient linked to your care before uploading a prescription."
      });
    }

    const relativePath = path.relative(path.join(__dirname, "..", ".."), req.file.path);
    const result = await insertMapped(connection, "prescription_ocr_jobs", {
      doctorId: req.doctorId,
      patientId,
      fileName: req.file.originalname,
      filePath: relativePath,
      mimeType: req.file.mimetype,
      createdAt: new Date(),
      status: "uploaded"
    });

    await connection.commit();

    res.status(201).json({
      success: true,
      message: "Prescription file saved and OCR job recorded.",
      jobId: result.insertId,
      note: "OCR extraction is available only if the existing OCR worker processes this job table."
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    console.error("Doctor OCR upload failed:", error.code || error.message);
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Unable to record the OCR upload. Check the existing OCR-job schema."
    });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;


