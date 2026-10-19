const express = require("express");
const { pool } = require("../db");
const { authRequired } = require("../middleware/authMiddleware");

const router = express.Router();
router.use(authRequired);

function staffOnly(req, res, next) {
  if (!["doctor", "receptionist"].includes(req.auth?.role)) {
    return res.status(403).json({
      success: false,
      message: "Only doctor and receptionist accounts can access the care-team inbox"
    });
  }
  next();
}

router.use(staffOnly);

router.get("/messages", async (req, res) => {
  try {
    const [messages] = await pool.execute(
      `SELECT m.message_id, m.patient_id, m.sender_user_id,
              m.recipient_user_id, m.message, m.created_at,
              s.full_name AS sender_name, s.role AS sender_role,
              r.full_name AS recipient_name, r.role AS recipient_role,
              pu.full_name AS patient_name, pu.email AS patient_email
         FROM post_discharge_messages m
         JOIN users s ON s.user_id = m.sender_user_id
         JOIN users r ON r.user_id = m.recipient_user_id
         JOIN patients p ON p.patient_id = m.patient_id
         JOIN users pu ON pu.user_id = p.user_id
        WHERE m.sender_user_id = ? OR m.recipient_user_id = ?
        ORDER BY m.created_at ASC, m.message_id ASC
        LIMIT 300`,
      [req.auth.userId, req.auth.userId]
    );

    res.json({ success: true, messages });
  } catch (error) {
    console.error("Care-team inbox lookup failed:", error.code || error.message);
    res.status(error.code === "ER_NO_SUCH_TABLE" ? 503 : 500).json({
      success: false,
      message: error.code === "ER_NO_SUCH_TABLE"
        ? "Post-discharge messaging has not been initialized"
        : "Unable to load the care-team inbox"
    });
  }
});

router.post("/messages", async (req, res) => {
  try {
    const patientId = Number(req.body.patientId);
    const message =
      typeof req.body.message === "string" ? req.body.message.trim() : "";

    if (!Number.isInteger(patientId) || patientId <= 0) {
      return res.status(400).json({
        success: false,
        message: "A valid patient ID is required"
      });
    }

    if (!message || message.length > 3000) {
      return res.status(400).json({
        success: false,
        message: "Reply must contain 1 to 3000 characters"
      });
    }

    const [patients] = await pool.execute(
      "SELECT user_id FROM patients WHERE patient_id = ? LIMIT 1",
      [patientId]
    );

    if (!patients.length) {
      return res.status(404).json({
        success: false,
        message: "Patient profile not found"
      });
    }

    const patientUserId = Number(patients[0].user_id);
    const staffUserId = Number(req.auth.userId);

    const [threads] = await pool.execute(
      `SELECT message_id
         FROM post_discharge_messages
        WHERE patient_id = ?
          AND (
            (sender_user_id = ? AND recipient_user_id = ?)
            OR
            (sender_user_id = ? AND recipient_user_id = ?)
          )
        LIMIT 1`,
      [
        patientId,
        patientUserId, staffUserId,
        staffUserId, patientUserId
      ]
    );

    if (!threads.length) {
      return res.status(403).json({
        success: false,
        message: "You can reply only to a patient conversation addressed to your account"
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO post_discharge_messages
         (patient_id, sender_user_id, recipient_user_id, message)
       VALUES (?, ?, ?, ?)`,
      [patientId, staffUserId, patientUserId, message]
    );

    res.status(201).json({
      success: true,
      message: "Reply sent",
      messageId: result.insertId
    });
  } catch (error) {
    console.error("Care-team reply failed:", error.code || error.message);
    res.status(error.code === "ER_NO_SUCH_TABLE" ? 503 : 500).json({
      success: false,
      message: "Unable to send the reply"
    });
  }
});

module.exports = router;
