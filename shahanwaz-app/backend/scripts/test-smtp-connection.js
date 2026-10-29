require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env")
});

const nodemailer = require("nodemailer");

async function main() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    String(process.env.SMTP_SECURE || "").toLowerCase() === "true"
    || port === 465;

  if (!host || !user || !pass) {
    console.error("SMTP configuration is incomplete.");
    process.exitCode = 1;
    return;
  }

  console.log("SMTP host:", host);
  console.log("SMTP port:", port);
  console.log("TLS mode:", secure ? "Implicit TLS" : "STARTTLS/automatic");
  console.log("SMTP username configured:", Boolean(user));
  console.log("SMTP password configured:", Boolean(pass));
  console.log("\nTesting SMTP connection and authentication...");

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  });

  try {
    await transporter.verify();
    console.log("SUCCESS: SMTP connection and authentication verified.");
  } catch (error) {
    console.error("SMTP test FAILED.");
    console.error("Error code:", error.code || "not provided");
    console.error("Error command:", error.command || "not provided");
    console.error("SMTP response code:", error.responseCode || "not provided");
    console.error("Error message:", error.message || "not provided");
    process.exitCode = 1;
  } finally {
    transporter.close();
  }
}

main().catch(error => {
  console.error("Diagnostic failed:", error.code || error.message);
  process.exitCode = 1;
});