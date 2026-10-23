const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "rag_healthcare",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function testDatabaseConnection() {
  const connection = await pool.getConnection();

  try {
    const [rows] = await connection.query(
      "SELECT DATABASE() AS database_name, 1 AS connection_ok"
    );
    return rows[0];
  } finally {
    connection.release();
  }
}

module.exports = { pool, testDatabaseConnection };
