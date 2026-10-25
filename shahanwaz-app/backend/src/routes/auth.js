const express = require("express");
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

module.exports = router;
