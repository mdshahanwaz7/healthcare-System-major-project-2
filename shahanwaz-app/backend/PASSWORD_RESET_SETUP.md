# Email-link Forgot Password setup (Patient, Doctor, Receptionist)

The recovery flow sends a single-use link to the email registered to the selected role. The link expires after 15 minutes. The database stores only the SHA-256 digest of the random token; the token is invalidated after use and other active tokens for that account are invalidated when a new link is issued.

## Required environment variables in backend .env

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-account@gmail.com
SMTP_PASS=your-gmail-app-password
SMTP_FROM=your-account@gmail.com
FRONTEND_URL=http://localhost:5173
```

Use the real credentials for your provider. For Gmail SMTP, use a Google App Password (with 2-Step Verification enabled), not the normal Gmail account password. Do not commit `.env` or share passwords.

`PASSWORD_RESET_FRONTEND_URL` can optionally override `FRONTEND_URL` for reset links. If neither is set, the backend uses `http://localhost:5173`.

## Database

The API uses the existing `password_reset_codes` table in the same MySQL database configured in `src/db.js`. That table must have `user_id`, `role`, `email`, `code_hash`, `expires_at`, `attempts`, `verified_at`, `used_at`, and `created_at` columns. It does not create tables at runtime.

The application database account needs SELECT, INSERT, UPDATE, and DELETE privileges on this table. The current recovery implementation uses `code_hash` to store the SHA-256 token digest. Old unused six-digit-code records are invalidated when a new link is created.

## Testing

Restart the Express backend after updating `.env`. Test Forgot Password for each role using an email already registered to that role. The request response is intentionally generic. Check the mail server logs if sending fails. Opening the reset link loads the standalone frontend recovery page; the password can be changed only after the backend validates the unexpired, unused token.