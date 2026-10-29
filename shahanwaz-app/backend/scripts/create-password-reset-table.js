require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { pool } = require("../src/db");

async function main() {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS password_reset_codes (
        reset_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT NOT NULL,
        role ENUM('patient', 'doctor', 'receptionist') NOT NULL,
        email VARCHAR(100) NOT NULL,
        code_hash CHAR(64) NOT NULL,
        expires_at DATETIME NOT NULL,
        attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
        verified_at DATETIME NULL,
        used_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (reset_id),
        KEY idx_password_reset_email_role_created (email, role, created_at),
        KEY idx_password_reset_user_created (user_id, created_at),
        KEY idx_password_reset_expiry (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log("SUCCESS: password_reset_codes table is ready.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("FAILED to create password-reset table:", error.code || error.message);
  process.exitCode = 1;
});