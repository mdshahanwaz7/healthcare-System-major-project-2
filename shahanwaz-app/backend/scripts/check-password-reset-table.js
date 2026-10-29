require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env")
});

const { pool } = require("../src/db");

async function main() {
  try {
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS total FROM password_reset_codes"
    );

    console.log(
      "SUCCESS: Password-reset table accessible. Rows:",
      rows[0].total
    );
  } catch (error) {
    console.error("Error code:", error.code || "unknown");
    console.error("Error message:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();