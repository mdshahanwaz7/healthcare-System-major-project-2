const express = require("express");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const { authRequired } = require("../middleware/authMiddleware");

const router = express.Router();

function createToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    {
      sub: String(user.user_id),
      role: user.role
    },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );
}

function safeUser(user) {
  return {
    userId: user.user_id,
    fullName: user.full_name,
    email: user.email,
    role: user.role,
    phone: user.phone || null
  };
}

// Public registration creates patient accounts only.
// Doctor and receptionist accounts must be provisioned through a controlled process.
router.post("/register", async (req, res) => {
  const fullName =
    typeof req.body.fullName === "string" ? req.body.fullName.trim() : "";
  const email =
    typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password =
    typeof req.body.password === "string" ? req.body.password : "";
  const phone =
    typeof req.body.phone === "string" ? req.body.phone.trim() : null;
  const requestedRole = req.body.role;

  if (!fullName || fullName.length > 100) {
    return res.status(400).json({
      success: false,
      message: "Full name is required and must be at most 100 characters"
    });
  }

  if (
    !email ||
    email.length > 100 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid email address"
    });
  }

  if (
    password.length < 8 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 8 characters and at most 72 UTF-8 bytes"
    });
  }

  if (phone && phone.length > 20) {
    return res.status(400).json({
      success: false,
      message: "Phone must be at most 20 characters"
    });
  }

  if (requestedRole && requestedRole !== "patient") {
    return res.status(403).json({
      success: false,
      message: "Public registration is currently available for patient accounts only"
    });
  }

  let connection;

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existingUsers] = await connection.execute(
      "SELECT user_id FROM users WHERE email = ? LIMIT 1",
      [email]
    );

    if (existingUsers.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists"
      });
    }

    const [result] = await connection.execute(
      `INSERT INTO users (full_name, email, password, role, phone)
       VALUES (?, ?, ?, 'patient', ?)`,
      [fullName, email, passwordHash, phone || null]
    );

    await connection.execute(
      "INSERT INTO patients (user_id, registration_status) VALUES (?, 'self_registered')",
      [result.insertId]
    );

    const user = {
      user_id: result.insertId,
      full_name: fullName,
      email,
      role: "patient",
      phone: phone || null
    };

    const token = createToken(user);

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Patient account created successfully",
      token,
      user: safeUser(user)
    });
  } catch (error) {
    if (connection) {
      await connection.rollback().catch(() => {});
    }

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists"
      });
    }

    console.error("Registration failed:", error.code || error.name || "unknown");
    return res.status(500).json({
      success: false,
      message: "Unable to create the account"
    });
  } finally {
    if (connection) connection.release();
  }
});

// Existing patient, doctor, and receptionist accounts can sign in.
router.post("/login", async (req, res) => {
  const email =
    typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password =
    typeof req.body.password === "string" ? req.body.password : "";

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required"
    });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT user_id, full_name, email, password, role, phone
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const user = rows[0];
    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const token = createToken(user);

    return res.json({
      success: true,
      message: "Login successful",
      token,
      user: safeUser(user)
    });
  } catch (error) {
    console.error("Login failed:", error.code || error.name || "unknown");
    return res.status(500).json({
      success: false,
      message: "Unable to log in at this time"
    });
  }
});

// Return the signed-in user's account and their own role-specific profile.
router.get("/me", authRequired, async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT user_id, full_name, email, role, phone
       FROM users
       WHERE user_id = ?
       LIMIT 1`,
      [req.auth.userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Account not found"
      });
    }

    const user = users[0];
    let profile = null;

    if (user.role === "patient") {
      const [profiles] = await pool.execute(
        `SELECT patient_id, date_of_birth, gender, blood_group,
                address, emergency_contact, allergies
         FROM patients
         WHERE user_id = ?
         LIMIT 1`,
        [user.user_id]
      );
      profile = profiles[0] || null;
    } else if (user.role === "doctor") {
      const [profiles] = await pool.execute(
        `SELECT doctor_id, specialization, qualification, license_number,
                experience_years, bio
         FROM doctors
         WHERE user_id = ?
         LIMIT 1`,
        [user.user_id]
      );
      profile = profiles[0] || null;
    }

    return res.json({
      success: true,
      user: safeUser(user),
      profile
    });
  } catch (error) {
    console.error("Current-user lookup failed:", error.code || error.name || "unknown");
    return res.status(500).json({
      success: false,
      message: "Unable to load the current account"
    });
  }
});


// EMAIL_LINK_PASSWORD_RECOVERY_V1
function createResetMailer() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host,
    port,
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465,
    auth: { user, pass }
  });
}

function validResetRole(role) {
  return ["patient", "doctor", "receptionist"].includes(role);
}

function validResetEmail(value) {
  return typeof value === "string" && value.trim().length <= 100 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function resetTokenDigest(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

router.post("/forgot-password/request", async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const role = req.body.role;
  if (!validResetEmail(email) || !validResetRole(role)) {
    return res.status(400).json({ success: false, message: "Enter a valid registered email and select your account role." });
  }

  const mailer = createResetMailer();
  if (!mailer || (!process.env.SMTP_FROM && !process.env.SMTP_USER)) {
    return res.status(503).json({ success: false, message: "Email recovery is not configured yet. Please contact the administrator." });
  }

  try {
    const [users] = await pool.execute(
      "SELECT user_id, email, role FROM users WHERE email = ? AND role = ? LIMIT 1",
      [email, role]
    );

    // Identical response for unknown emails and existing accounts prevents account enumeration.
    if (users.length) {
      const account = users[0];
      const [recent] = await pool.execute(
        "SELECT reset_id FROM password_reset_codes WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND) AND used_at IS NULL ORDER BY created_at DESC LIMIT 1",
        [account.user_id]
      );

      if (!recent.length) {
        await pool.execute(
          "UPDATE password_reset_codes SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL",
          [account.user_id]
        );

        const rawToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = resetTokenDigest(rawToken);
        await pool.execute(
          "INSERT INTO password_reset_codes (user_id, role, email, code_hash, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE))",
          [account.user_id, role, email, tokenHash]
        );

        const frontendBase = String(
          process.env.PASSWORD_RESET_FRONTEND_URL || process.env.FRONTEND_URL || "http://localhost:5173"
        ).replace(/\/+$/, "");
        const resetUrl = new URL(frontendBase);
        resetUrl.searchParams.set("resetToken", rawToken);
        resetUrl.searchParams.set("role", role);
        const resetLink = resetUrl.toString();
        const safeResetLink = resetLink.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

        try {
          await mailer.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: email,
            subject: "Reset your Healthcare account password",
            text: `A password reset was requested for your Healthcare account. Open this single-use link within 15 minutes to choose a new password:\n\n${resetLink}\n\nIf you did not request this, you can ignore this email.`,
            html: `<p>A password reset was requested for your Healthcare account.</p><p><a href="${safeResetLink}">Reset your password</a></p><p>This single-use link expires in 15 minutes.</p><p>If you did not request this, you can ignore this email.</p>`
          });
        } catch (mailError) {
          await pool.execute(
            "UPDATE password_reset_codes SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND code_hash = ? AND used_at IS NULL",
            [account.user_id, tokenHash]
          );
          console.error("Password reset link delivery failed:", mailError.code || mailError.name);
          return res.status(503).json({ success: false, message: "Could not send the password-reset link. Check SMTP settings and try again." });
        }
      }
    }

    return res.json({
      success: true,
      message: "If an account matches the selected role and email, a password-reset link will be sent to that address. The link expires in 15 minutes."
    });
  } catch (error) {
    console.error("Password reset link request failed:", error.code || error.name);
    return res.status(500).json({ success: false, message: "Password recovery is temporarily unavailable. Please try again." });
  }
});

router.post("/forgot-password/reset", async (req, res) => {
  const token = typeof req.body.token === "string" ? req.body.token.trim() : "";
  const role = req.body.role;
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!/^[a-f0-9]{64}$/i.test(token) || !validResetRole(role) || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return res.status(400).json({ success: false, message: "This reset link is invalid or expired. Request a new link and use a password of at least 8 characters." });
  }

  let connection;
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const tokenHash = resetTokenDigest(token);
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [records] = await connection.execute(
      "SELECT reset_id, user_id FROM password_reset_codes WHERE role = ? AND code_hash = ? AND expires_at > UTC_TIMESTAMP() AND used_at IS NULL LIMIT 1 FOR UPDATE",
      [role, tokenHash]
    );
    if (!records.length) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "This reset link is invalid, expired, or already used. Request a new link." });
    }

    const record = records[0];
    const [updated] = await connection.execute(
      "UPDATE users SET password = ? WHERE user_id = ? AND role = ?",
      [passwordHash, record.user_id, role]
    );
    if (!updated.affectedRows) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "The account could not be updated. Request a new reset link." });
    }

    await connection.execute(
      "UPDATE password_reset_codes SET used_at = UTC_TIMESTAMP() WHERE reset_id = ? AND used_at IS NULL",
      [record.reset_id]
    );
    await connection.execute(
      "UPDATE password_reset_codes SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL",
      [record.user_id]
    );
    await connection.commit();
    return res.json({ success: true, message: "Password reset successfully. Sign in using your new password." });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Password reset failed:", error.code || error.name);
    return res.status(500).json({ success: false, message: "Unable to reset the password right now. Please try again." });
  } finally {
    if (connection) connection.release();
  }
});
module.exports = router;
