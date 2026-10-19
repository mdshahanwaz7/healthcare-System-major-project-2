const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db");

const router = express.Router();

router.post("/", async (req, res) => {
  const fullName = typeof req.body.fullName === "string" ? req.body.fullName.trim() : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const phone = typeof req.body.phone === "string" ? req.body.phone.trim() : "";
  const specialization = typeof req.body.specialization === "string" ? req.body.specialization.trim() : "";
  const doctorType = typeof req.body.doctorType === "string" ? req.body.doctorType.trim() : "OPD";

  if (!["OPD", "Surgeon", "General Physician", "Other"].includes(doctorType)) {
    return res.status(400).json({
      success: false,
      message: "Choose a valid doctor category."
    });
  }
  const qualification = typeof req.body.qualification === "string" ? req.body.qualification.trim() : "";
  const licenseNumber = typeof req.body.licenseNumber === "string" ? req.body.licenseNumber.trim() : "";
  const bio = typeof req.body.bio === "string" ? req.body.bio.trim() : "";
  const experienceYears = req.body.experienceYears === "" || req.body.experienceYears == null
    ? null
    : Number(req.body.experienceYears);

  if (!fullName || fullName.length > 100) {
    return res.status(400).json({ success: false, message: "Enter a valid full name (maximum 100 characters)." });
  }
  if (!email || email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: "Enter a valid email address." });
  }
  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return res.status(400).json({ success: false, message: "Password must be at least 8 characters and at most 72 UTF-8 bytes." });
  }
  if (phone.length > 20) {
    return res.status(400).json({ success: false, message: "Phone number must not exceed 20 characters." });
  }
  if (!specialization || specialization.length > 150) {
    return res.status(400).json({ success: false, message: "Specialization is required." });
  }
  if (!licenseNumber || licenseNumber.length > 100) {
    return res.status(400).json({ success: false, message: "Professional license number is required." });
  }
  if (qualification.length > 150 || bio.length > 5000) {
    return res.status(400).json({ success: false, message: "Qualification or profile description is too long." });
  }
  if (experienceYears !== null &&
      (!Number.isInteger(experienceYears) || experienceYears < 0 || experienceYears > 80)) {
    return res.status(400).json({ success: false, message: "Experience must be a whole number from 0 to 80." });
  }

  try {
    const [existingUsers] = await pool.execute(
      "SELECT user_id FROM users WHERE LOWER(email) = ? LIMIT 1",
      [email]
    );

    if (existingUsers.length) {
      return res.status(409).json({
        success: false,
        message: "This email already has an account. Try signing in."
      });
    }

    const [existingApplications] = await pool.execute(
      "SELECT request_id, status FROM doctor_registration_requests WHERE LOWER(email) = ? LIMIT 1",
      [email]
    );

    if (existingApplications.length) {
      return res.status(409).json({
        success: false,
        message: existingApplications[0].status === "pending"
          ? "An application with this email is already awaiting review."
          : "An application already exists for this email. Contact the front desk."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await pool.execute(
      `INSERT INTO doctor_registration_requests
         (full_name, email, password_hash, phone, doctor_type, specialization, qualification, license_number, experience_years, bio)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fullName,
        email,
        passwordHash,
        phone || null,
        doctorType,
        specialization,
        qualification || null,
        licenseNumber,
        experienceYears,
        bio || null
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Doctor application submitted. Please sign in after the Receptionist has approved your professional registration."
    });
  } catch (error) {
    console.error("Doctor registration request failed:", error.code || error.message);
    return res.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({
      success: false,
      message: error.code === "ER_DUP_ENTRY"
        ? "An application with this email or license number already exists."
        : "Unable to submit the doctor application."
    });
  }
});

module.exports = router;
