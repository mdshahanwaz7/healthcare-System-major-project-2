const jwt = require("jsonwebtoken");

function authRequired(req, res, next) {
  const header = req.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);

  if (!match) {
    return res.status(401).json({
      success: false,
      message: "Authentication token is required"
    });
  }

  try {
    const payload = jwt.verify(match[1], process.env.JWT_SECRET);
    const userId = Number(payload.sub);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token"
      });
    }

    req.auth = { userId, role: payload.role };
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token"
    });
  }
}

module.exports = { authRequired };
