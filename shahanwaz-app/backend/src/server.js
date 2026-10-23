require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { testDatabaseConnection } = require("./db");
const authRoutes = require("./routes/auth");

const app = express();
const PORT = Number(process.env.PORT || 5001);

const configuredFrontendOrigin =
  process.env.FRONTEND_URL || "http://localhost:5173";

function allowFrontendOrigin(origin, callback) {
  if (!origin || origin === configuredFrontendOrigin) {
    return callback(null, true);
  }

  try {
    const parsed = new URL(origin);
    const localHost = [
      "localhost",
      "127.0.0.1"
    ].includes(parsed.hostname);

    const port = Number(parsed.port || 80);

    const allowed =
      parsed.protocol === "http:" &&
      localHost &&
      port >= 5173 &&
      port <= 5190;

    if (allowed) {
      return callback(null, true);
    }

    return callback(new Error("Frontend origin is not allowed"));
  } catch {
    return callback(new Error("Invalid frontend origin"));
  }
}

app.use(cors({ origin: allowFrontendOrigin }));
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Unified Healthcare Platform API"
  });
});

app.get("/api/health", async (req, res) => {
  try {
    const database = await testDatabaseConnection();

    res.json({
      success: true,
      service: "unified-healthcare-backend",
      database: database.database_name,
      database_connected: true,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(
      "Database connection failed:",
      error.code || error.message
    );

    res.status(503).json({
      success: false,
      service: "unified-healthcare-backend",
      database_connected: false,
      message: "Database connection failed"
    });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/patient", require("./routes/patient"));
app.use("/api/care-team", require("./routes/careTeam"));

app.use("/api/doctor-registration", require("./routes/doctorRegistration"));
app.use("/api/doctor", require("./routes/doctor"));
app.use("/api/receptionist", require("./routes/receptionist"));

app.listen(PORT, () => {
  console.log(
    `Unified Healthcare API running at http://localhost:${PORT}`
  );
});




