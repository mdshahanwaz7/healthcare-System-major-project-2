const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db");
const { authRequired } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authRequired, (req, res, next) => {
  if (req.auth?.role !== "receptionist") {
    return res.status(403).json({
      success: false,
      message: "Receptionist access is required"
    });
  }
  next();
});

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function validTime(value) {
  return typeof value === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

async function listAppointments(status = "all", limit = 300) {
  let where = "";
  const params = [];

  if (status !== "all") {
    where = "WHERE a.status = ?";
    params.push(status);
  }

  params.push(limit);

  const [rows] = await pool.execute(
    `SELECT
        a.appointment_id,
        a.patient_id,
        a.doctor_id,
        a.appointment_date,
        a.start_time,
        a.end_time,
        a.reason,
        a.status,
        pu.full_name AS patient_name,
        pu.email AS patient_email,
        du.full_name AS doctor_name,
        du.email AS doctor_email,
        d.specialization AS doctor_specialization
     FROM appointments a
     JOIN patients p ON p.patient_id = a.patient_id
     JOIN users pu ON pu.user_id = p.user_id
     JOIN doctors d ON d.doctor_id = a.doctor_id
     JOIN users du ON du.user_id = d.user_id
     ${where}
     ORDER BY a.appointment_date DESC, a.start_time DESC
     LIMIT ?`,
    params
  );

  return rows;
}

router.get("/dashboard", async (req, res) => {
  try {
    const [[patientRows], [doctorRows], [bookingRows]] = await Promise.all([
      pool.query("SELECT COUNT(*) AS total FROM patients"),
      pool.query("SELECT COUNT(*) AS total FROM doctors"),
      pool.query(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END), 0)
             AS pending_scheduled
         FROM appointments`
      )
    ]);

    const recentAppointments = await listAppointments("all", 6);

    res.json({
      success: true,
      summary: {
        registeredPatients: Number(patientRows[0].total),
        activePhysicians: Number(doctorRows[0].total),
        totalBookings: Number(bookingRows[0].total),
        pendingScheduled: Number(bookingRows[0].pending_scheduled)
      },
      recentAppointments
    });
  } catch (error) {
    console.error("Receptionist dashboard failed:", error.code || error.message);
    res.status(500).json({
      success: false,
      message: "Unable to load the front desk dashboard"
    });
  }
});

router.get("/patients", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();

    let sql = `
      SELECT p.patient_id, p.user_id,
             u.full_name, u.email, u.phone, u.created_at,
             p.date_of_birth, p.gender, p.blood_group,
             p.address, p.emergency_contact, p.allergies
        FROM patients p
        JOIN users u ON u.user_id = p.user_id
       WHERE u.role = 'patient'`;

    const params = [];

    if (search) {
      sql += ` AND (
        u.full_name LIKE ? OR u.email LIKE ? OR
        COALESCE(u.phone, '') LIKE ? OR
        CAST(p.patient_id AS CHAR) LIKE ?
      )`;
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    sql += " ORDER BY u.created_at DESC, p.patient_id DESC LIMIT 500";

    const [patients] = await pool.execute(sql, params);

    res.json({
      success: true,
      patients
    });
  } catch (error) {
    console.error("Receptionist patient list failed:", error.code || error.message);
    res.status(500).json({
      success: false,
      message: "Unable to load registered patients"
    });
  }
});

router.post("/patients", async (req, res) => {
  const fullName =
    typeof req.body.fullName === "string" ? req.body.fullName.trim() : "";
  const email =
    typeof req.body.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";
  const phone =
    typeof req.body.phone === "string" ? req.body.phone.trim() : "";

  const dateOfBirth =
    typeof req.body.dateOfBirth === "string" ? req.body.dateOfBirth.trim() : "";
  const genderInput =
    typeof req.body.gender === "string" ? req.body.gender.trim() : "";
  const bloodGroupInput =
    typeof req.body.bloodGroup === "string" ? req.body.bloodGroup.trim() : "";
  const address =
    typeof req.body.address === "string" ? req.body.address.trim() : "";
  const emergencyContact =
    typeof req.body.emergencyContact === "string"
      ? req.body.emergencyContact.trim()
      : "";
  const allergies =
    typeof req.body.allergies === "string" ? req.body.allergies.trim() : "";

  const genders = ["Male", "Female", "Other"];
  const bloodGroups = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];

  const gender = genders.find(
    (item) => item.toLowerCase() === genderInput.toLowerCase()
  ) || "";

  const bloodGroup = bloodGroups.find(
    (item) => item.toLowerCase() === bloodGroupInput.toLowerCase()
  ) || "";

  if (!fullName || fullName.length > 100) {
    return res.status(400).json({
      success: false,
      message: "Full name is required and must not exceed 100 characters"
    });
  }

  if (
    !email ||
    email.length > 100 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid patient email address"
    });
  }

  if (!phone || phone.length > 20) {
    return res.status(400).json({
      success: false,
      message: "Phone number is required and must not exceed 20 characters"
    });
  }

  if (dateOfBirth && !validDate(dateOfBirth)) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid date of birth"
    });
  }

  if (dateOfBirth && dateOfBirth > new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({
      success: false,
      message: "Date of birth cannot be in the future"
    });
  }

  if (genderInput && !gender) {
    return res.status(400).json({
      success: false,
      message: "Select Male, Female, or Other for gender"
    });
  }

  if (bloodGroupInput && !bloodGroup) {
    return res.status(400).json({
      success: false,
      message: "Select a valid blood group"
    });
  }

  let connection;

  try {
    // Use the actual MySQL column lengths when validating optional text.
    for (const field of [
      ["address", address, "Address / City"],
      ["emergency_contact", emergencyContact, "Emergency Contact"],
      ["allergies", allergies, "Recorded Allergies"]
    ]) {
      const [metadata] = await pool.execute(
        `SELECT CHARACTER_MAXIMUM_LENGTH AS maxLength
           FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'patients'
            AND COLUMN_NAME = ?
          LIMIT 1`,
        [field[0]]
      );

      const maximum = metadata[0]?.maxLength;
      if (maximum && field[1].length > Number(maximum)) {
        return res.status(400).json({
          success: false,
          message: `${field[2]} exceeds the database limit of ${maximum} characters`
        });
      }
    }

    const password = require("crypto").randomBytes(24).toString("base64url");
    const hash = await bcrypt.hash(password, 12);
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existing] = await connection.execute(
      "SELECT user_id FROM users WHERE email = ? LIMIT 1",
      [email]
    );

    if (existing.length) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists"
      });
    }

    const [userResult] = await connection.execute(
      `INSERT INTO users (full_name, email, password, role, phone)
       VALUES (?, ?, ?, 'patient', ?)`,
      [fullName, email, hash, phone]
    );

    const [profileResult] = await connection.execute(
      `INSERT INTO patients
         (user_id, date_of_birth, gender, blood_group, address,
          emergency_contact, allergies)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userResult.insertId,
        dateOfBirth || null,
        gender || null,
        bloodGroup || null,
        address || null,
        emergencyContact || null,
        allergies || null
      ]
    );

    await connection.commit();

    res.status(201).json({
      success: true,
      message: "Patient registered successfully",
      temporaryPassword: password,
      patient: {
        patient_id: profileResult.insertId,
        user_id: userResult.insertId,
        full_name: fullName,
        email,
        phone,
        date_of_birth: dateOfBirth || null,
        gender: gender || null,
        blood_group: bloodGroup || null,
        address: address || null,
        emergency_contact: emergencyContact || null,
        allergies: allergies || null
      }
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});

    console.error("Patient registration failed:", error.code || error.message);

    res.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({
      success: false,
      message: error.code === "ER_DUP_ENTRY"
        ? "An account with this email already exists"
        : "Unable to register the patient"
    });
  } finally {
    if (connection) connection.release();
  }
});

router.get("/doctors", async (req, res) => {
  try {
    const [doctors] = await pool.execute(
      `SELECT d.doctor_id, d.user_id, d.doctor_type, d.specialization, d.qualification,
              d.license_number, d.experience_years, d.bio,
              u.full_name, u.email, u.phone
         FROM doctors d
         JOIN users u ON u.user_id = d.user_id
        WHERE u.role = 'doctor'
        ORDER BY u.full_name
        LIMIT 500`
    );

    res.json({ success: true, doctors });
  } catch (error) {
    console.error("Doctor directory failed:", error.code || error.message);
    res.status(500).json({
      success: false,
      message: "Unable to load the physician directory"
    });
  }
});

router.get("/appointments", async (req, res) => {
  const requestedStatus = String(req.query.status || "all").toLowerCase();
  const validStatuses = ["all", "scheduled", "completed", "cancelled"];

  if (!validStatuses.includes(requestedStatus)) {
    return res.status(400).json({
      success: false,
      message: "Invalid appointment status filter"
    });
  }

  try {
    const appointments = await listAppointments(requestedStatus, 500);
    res.json({ success: true, appointments });
  } catch (error) {
    console.error("Appointment list failed:", error.code || error.message);
    res.status(500).json({
      success: false,
      message: "Unable to load appointments"
    });
  }
});

router.post("/appointments", async (req, res) => {
  const patientId = Number(req.body.patientId);
  const doctorId = Number(req.body.doctorId);
  const appointmentDate = req.body.appointmentDate;
  const startTime = req.body.startTime;
  const endTime = req.body.endTime;
  const reason =
    typeof req.body.reason === "string" ? req.body.reason.trim() : "";

  if (!Number.isInteger(patientId) || patientId <= 0 ||
      !Number.isInteger(doctorId) || doctorId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Select a valid patient and doctor"
    });
  }

  if (!validDate(appointmentDate) ||
      appointmentDate < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({
      success: false,
      message: "Select a valid appointment date today or later"
    });
  }

  if (!validTime(startTime) || !validTime(endTime) || endTime <= startTime) {
    return res.status(400).json({
      success: false,
      message: "End time must be later than start time"
    });
  }

  if (reason.length > 500) {
    return res.status(400).json({
      success: false,
      message: "Appointment reason must not exceed 500 characters"
    });
  }

  try {
    const [patients] = await pool.execute(
      "SELECT patient_id FROM patients WHERE patient_id = ? LIMIT 1",
      [patientId]
    );

    if (!patients.length) {
      return res.status(404).json({
        success: false,
        message: "Selected patient was not found"
      });
    }

    const [doctors] = await pool.execute(
      `SELECT d.doctor_id
         FROM doctors d
         JOIN users u ON u.user_id = d.user_id
        WHERE d.doctor_id = ? AND u.role = 'doctor'
        LIMIT 1`,
      [doctorId]
    );

    if (!doctors.length) {
      return res.status(404).json({
        success: false,
        message: "Selected doctor was not found"
      });
    }

    const [doctorConflicts] = await pool.execute(
      `SELECT appointment_id
         FROM appointments
        WHERE doctor_id = ?
          AND appointment_date = ?
          AND status = 'scheduled'
          AND start_time < ?
          AND end_time > ?
        LIMIT 1`,
      [doctorId, appointmentDate, endTime, startTime]
    );

    if (doctorConflicts.length) {
      return res.status(409).json({
        success: false,
        message: "This doctor already has a scheduled appointment during that time"
      });
    }

    const [patientConflicts] = await pool.execute(
      `SELECT appointment_id
         FROM appointments
        WHERE patient_id = ?
          AND appointment_date = ?
          AND status = 'scheduled'
          AND start_time < ?
          AND end_time > ?
        LIMIT 1`,
      [patientId, appointmentDate, endTime, startTime]
    );

    if (patientConflicts.length) {
      return res.status(409).json({
        success: false,
        message: "This patient already has an appointment during that time"
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO appointments
         (doctor_id, patient_id, appointment_date, start_time,
          end_time, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled')`,
      [
        doctorId,
        patientId,
        appointmentDate,
        `${startTime}:00`,
        `${endTime}:00`,
        reason || null
      ]
    );

    res.status(201).json({
      success: true,
      message: "Appointment scheduled successfully",
      appointmentId: result.insertId
    });
  } catch (error) {
    console.error("Appointment scheduling failed:", error.code || error.message);
    res.status(500).json({
      success: false,
      message: "Unable to schedule the appointment"
    });
  }
});

router.patch("/appointments/:id/cancel", async (req, res) => {
  const appointmentId = Number(req.params.id);

  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid appointment ID"
    });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE appointments
          SET status = 'cancelled'
        WHERE appointment_id = ? AND status = 'scheduled'`,
      [appointmentId]
    );

    if (!result.affectedRows) {
      return res.status(409).json({
        success: false,
        message: "Appointment was not found or is no longer scheduled"
      });
    }

    res.json({
      success: true,
      message: "Appointment cancelled successfully"
    });
  } catch (error) {
    console.error("Appointment cancellation failed:", error.code || error.message);
    res.status(500).json({
      success: false,
      message: "Unable to cancel the appointment"
    });
  }
});

router.get("/doctor-applications", async (req, res) => {
  try {
    const [applications] = await pool.execute(
      `SELECT request_id, full_name, email, phone, specialization,
              qualification, license_number, doctor_type, experience_years, bio,
              status, created_at
         FROM doctor_registration_requests
        ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
                 created_at DESC
        LIMIT 200`
    );
    res.json({ success: true, applications });
  } catch (error) {
    console.error("Doctor application list failed:", error.code || error.message);
    res.status(500).json({
      success: false,
      message: "Unable to load doctor applications"
    });
  }
});

router.post("/doctor-applications/:id/approve", async (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return res.status(400).json({ success: false, message: "Invalid application ID." });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [requests] = await connection.execute(
      `SELECT * FROM doctor_registration_requests
        WHERE request_id = ? FOR UPDATE`,
      [requestId]
    );

    if (!requests.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "Doctor application not found." });
    }

    const application = requests[0];

    if (application.status !== "pending") {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: `This application has already been ${application.status}.`
      });
    }

    const [existing] = await connection.execute(
      "SELECT user_id FROM users WHERE LOWER(email) = ? LIMIT 1",
      [application.email.toLowerCase()]
    );

    if (existing.length) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "This email already belongs to an account; the application cannot be approved."
      });
    }

    const [userResult] = await connection.execute(
      `INSERT INTO users (full_name, email, password, role, phone)
       VALUES (?, ?, ?, 'doctor', ?)`,
      [
        application.full_name,
        application.email,
        application.password_hash,
        application.phone
      ]
    );

    const [doctorResult] = await connection.execute(
      `INSERT INTO doctors
         (user_id, doctor_type, specialization, qualification, license_number, experience_years, bio)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userResult.insertId,
        (application.doctor_type || "OPD"),
        application.specialization,
        application.qualification,
        application.license_number,
        application.experience_years,
        application.bio
      ]
    );

    await connection.execute(
      `UPDATE doctor_registration_requests
          SET status = 'approved', reviewed_by = ?, reviewed_at = NOW()
        WHERE request_id = ?`,
      [req.auth.userId, requestId]
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Doctor approved and account created successfully.",
      doctor: {
        doctor_id: doctorResult.insertId,
        user_id: userResult.insertId,
        full_name: application.full_name,
        email: application.email,
        specialization: application.specialization
      }
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Doctor approval failed:", error.code || error.message);
    res.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({
      success: false,
      message: error.code === "ER_DUP_ENTRY"
        ? "The license number or email conflicts with an existing record."
        : "Unable to approve the doctor application."
    });
  } finally {
    if (connection) connection.release();
  }
});

router.post("/doctor-applications/:id/reject", async (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return res.status(400).json({ success: false, message: "Invalid application ID." });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE doctor_registration_requests
          SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW()
        WHERE request_id = ? AND status = 'pending'`,
      [req.auth.userId, requestId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: "Pending application was not found."
      });
    }

    res.json({ success: true, message: "Doctor application rejected." });
  } catch (error) {
    console.error("Doctor rejection failed:", error.code || error.message);
    res.status(500).json({ success: false, message: "Unable to reject this application." });
  }
});
module.exports = router;



