
import type { Express, NextFunction, Request, Response } from "express";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { pool } from "./db";
import {
  hashRateLimitKey,
  normalizeSuperAdminEmail,
  readCookie,
  requestHasSameOrigin,
  secureTokenEqual,
  SUPER_ADMIN_LOGIN_LIMIT,
  SUPER_ADMIN_IDLE_TIMEOUT_MS,
  SUPER_ADMIN_SESSION_COOKIE,
  SUPER_ADMIN_SESSION_TTL_MS,
} from "./super-admin-security";

type ActiveSuperAdmin = {
  id: number;
  email: string;
  csrfToken: string;
  sessionId: number;
};

declare global {
  namespace Express {
    interface Request {
      superAdmin?: ActiveSuperAdmin;
    }
  }
}

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
  maxAge: SUPER_ADMIN_SESSION_TTL_MS,
};

function requestHasSessionIndependentOrigin(req: Request): boolean {
  const origin = req.get("origin");

  if (requestHasSameOrigin(origin, req.get("host"))) {
    return true;
  }

  if (!origin) return false;

  const allowedOrigins = (
    process.env.SUPER_ADMIN_ALLOWED_ORIGINS ?? ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  try {
    const requestOrigin = new URL(origin).origin;

    return allowedOrigins.some((allowedOrigin) => {
      try {
        return new URL(allowedOrigin).origin === requestOrigin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function requireSameOrigin(req: Request, res: Response): boolean {
  if (requestHasSessionIndependentOrigin(req)) {
    return true;
  }

  res.status(403).json({
    message: "Request origin could not be verified.",
  });

  return false;
}

export async function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  res.setHeader("Cache-Control", "private, no-store");

  try {
    const token = readCookie(
      req.headers.cookie,
      SUPER_ADMIN_SESSION_COOKIE,
    );

    if (!token || token.length > 200) {
      res.status(401).json({
        message: "Super Admin authentication required.",
      });
      return;
    }

    const digest = hashRateLimitKey(token);

    const result = await pool.query(
      `UPDATE super_admin_sessions s
       SET last_seen_at = now()
       FROM super_admin_accounts a
       WHERE s.token_hash = $1
         AND s.super_admin_id = a.id
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND s.last_seen_at > now() - ($2::bigint * interval '1 millisecond')
         AND a.is_active = true
       RETURNING s.id AS session_id, s.csrf_token, a.id, a.email`,
      [digest, SUPER_ADMIN_IDLE_TIMEOUT_MS],
    );

    const row = result.rows[0];

    if (!row) {
      res.status(401).json({
        message: "Super Admin session expired or revoked.",
      });
      return;
    }

    req.superAdmin = {
      id: Number(row.id),
      email: String(row.email),
      csrfToken: String(row.csrf_token),
      sessionId: Number(row.session_id),
    };

    next();
  } catch (error: unknown) {
    console.error(
      "[super-admin-session] Failed:",
      error instanceof Error ? error.message : "Unknown error",
    );

    res.status(503).json({
      message: "Unable to verify Super Admin access.",
    });
  }
}

export async function verifySuperAdminPassword(
  accountId: number,
  password: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT password_hash
     FROM super_admin_accounts
     WHERE id = $1 AND is_active = true
     LIMIT 1`,
    [accountId],
  );

  const hash = result.rows[0]?.password_hash;

  if (typeof hash !== "string") {
    return false;
  }

  return argon2.verify(hash, password);
}

export function requireSuperAdminCsrf(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!requireSameOrigin(req, res)) {
    return;
  }

  const provided = req.get("x-super-admin-csrf");

  if (
    !req.superAdmin ||
    !provided ||
    !secureTokenEqual(req.superAdmin.csrfToken, provided)
  ) {
    res.status(403).json({
      message: "Super Admin request verification failed.",
    });
    return;
  }

  next();
}

export function registerSuperAdminAuthRoutes(app: Express): void {
  app.use("/api/super-admin", (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });

  app.post(
    "/api/super-admin/login",
    async (req, res): Promise<void> => {
      if (!requireSameOrigin(req, res)) {
        return;
      }

      const email = normalizeSuperAdminEmail(req.body?.email);
      const password = req.body?.password;

      if (
        !email ||
        typeof password !== "string" ||
        password.length < 1 ||
        password.length > 1024
      ) {
        res.status(400).json({
          message: "Enter a valid email and password.",
        });
        return;
      }

      const emailHash = hashRateLimitKey(email);
      const ipHash = hashRateLimitKey(req.ip || "unknown");

      let loginStage = "initializing login";

      try {
        const keys = [
          { scope: "email", hash: emailHash },
          { scope: "ip", hash: ipHash },
        ];

        loginStage = "checking login rate limit";

        const blocked = await pool.query(
          `SELECT 1
           FROM super_admin_login_attempts
           WHERE (
             (scope = $1 AND key_hash = $2)
             OR (scope = $3 AND key_hash = $4)
           )
           AND locked_until > now()
           LIMIT 1`,
          [
            keys[0].scope,
            keys[0].hash,
            keys[1].scope,
            keys[1].hash,
          ],
        );

        if (blocked.rowCount) {
          res.setHeader("Retry-After", "900");
          res.status(429).json({
            message: "Too many login attempts. Try again later.",
          });
          return;
        }

        loginStage = "looking up account";

        const accountResult = await pool.query(
          `SELECT id, email, password_hash
           FROM super_admin_accounts
           WHERE email = $1 AND is_active = true
           LIMIT 1`,
          [email],
        );

        const account = accountResult.rows[0];

        loginStage = "verifying password";

        const valid = account
          ? await argon2.verify(
              String(account.password_hash),
              password,
            )
          : (
              await argon2.hash(password, {
                type: argon2.argon2id,
              }),
              false
            );

        loginStage = "processing password result";

        if (!valid || !account) {
          loginStage = "recording failed login attempt";

          await Promise.all(
            keys.map(({ scope, hash }) =>
              pool.query(
                `INSERT INTO super_admin_login_attempts
                   (scope, key_hash, failure_count, window_started_at,
                    locked_until, updated_at)
                 VALUES ($1, $2, 1, now(), NULL, now())
                 ON CONFLICT (scope, key_hash) DO UPDATE SET
                   failure_count = CASE
                     WHEN super_admin_login_attempts.window_started_at
                       < now() - interval '15 minutes'
                     THEN 1
                     ELSE super_admin_login_attempts.failure_count + 1
                   END,
                   window_started_at = CASE
                     WHEN super_admin_login_attempts.window_started_at
                       < now() - interval '15 minutes'
                     THEN now()
                     ELSE super_admin_login_attempts.window_started_at
                   END,
                   locked_until = CASE
                     WHEN (
                       CASE
                         WHEN super_admin_login_attempts.window_started_at
                           < now() - interval '15 minutes'
                         THEN 1
                         ELSE super_admin_login_attempts.failure_count + 1
                       END
                     ) >= $3
                     THEN now() + interval '15 minutes'
                     ELSE NULL
                   END,
                   updated_at = now()`,
                [scope, hash, SUPER_ADMIN_LOGIN_LIMIT],
              ),
            ),
          );

          res.status(401).json({
            message: "Invalid email or password.",
          });
          return;
        }

        loginStage = "clearing failed attempts";

        await pool.query(
          `DELETE FROM super_admin_login_attempts
           WHERE (scope = 'email' AND key_hash = $1)
              OR (scope = 'ip' AND key_hash = $2)`,
          [emailHash, ipHash],
        );

        const token = randomBytes(32).toString("base64url");
        const csrfToken = randomBytes(32).toString("base64url");

        loginStage = "creating session";

        await pool.query(
          `INSERT INTO super_admin_sessions
             (super_admin_id, token_hash, csrf_token, expires_at,
              created_at, last_seen_at)
           VALUES ($1, $2, $3, now() + interval '8 hours', now(), now())`,
          [
            account.id,
            hashRateLimitKey(token),
            csrfToken,
          ],
        );

        loginStage = "updating last login";

        await pool.query(
          `UPDATE super_admin_accounts
           SET last_login_at = now()
           WHERE id = $1`,
          [account.id],
        );

        res.cookie(
          SUPER_ADMIN_SESSION_COOKIE,
          token,
          SESSION_COOKIE_OPTIONS,
        );

        res.json({
          id: Number(account.id),
          email: String(account.email),
          csrfToken,
        });
      } catch (error: unknown) {
        console.error(
          "[super-admin-login] Failed at:",
          loginStage,
        );

        console.error(
          "[super-admin-login] Error:",
          error instanceof Error
            ? error.message
            : "Unknown error",
        );

        res.status(503).json({
          message: "Unable to complete Super Admin login.",
        });
      }
    },
  );

  app.get(
    "/api/super-admin/session",
    requireSuperAdmin,
    async (req, res): Promise<void> => {
      res.json({
        id: req.superAdmin!.id,
        email: req.superAdmin!.email,
        csrfToken: req.superAdmin!.csrfToken,
      });
    },
  );

  app.post(
    "/api/super-admin/logout",
    requireSuperAdmin,
    requireSuperAdminCsrf,
    async (req, res): Promise<void> => {
      await pool.query(
        `UPDATE super_admin_sessions
         SET revoked_at = now()
         WHERE id = $1 AND revoked_at IS NULL`,
        [req.superAdmin!.sessionId],
      );

      res.clearCookie(
        SUPER_ADMIN_SESSION_COOKIE,
        {
          ...SESSION_COOKIE_OPTIONS,
          maxAge: undefined,
        },
      );

      res.sendStatus(204);
    },
  );
}
