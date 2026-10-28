import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { checkSessionContext, requirePendingAdminInitialization } from "./routes/routes";
import { registerTeacherRoutes } from "./teacher-routes";
import { storage } from "./storage";
import { pool } from "./db";

test("only exact authentication POST routes bypass archived-session write checks", async (t) => {
  const originalGetSession = storage.getAcademicSessionById;
  storage.getAcademicSessionById = async (id: number) => {
    if (id === 41) return { id: 41, schoolId: 11, isActive: false } as any;
    if (id === 88) return { id: 88, schoolId: 12, isActive: true } as any;
    return undefined;
  };
  t.after(() => {
    storage.getAcademicSessionById = originalGetSession;
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: 7, schoolId: 11 };
    next();
  });
  app.use(checkSessionContext);

  const authPaths = [
    "/api/login",
    "/api/teacher-login",
    "/api/student-login",
    "/api/students/verify",
    "/api/students/activate",
    "/api/teacher/change-password",
    "/api/admin/verify-pin",
  ];
  for (const path of authPaths) {
    app.post(path, (_req, res) => res.status(204).end());
  }
  app.post("/api/test-academic-write", (_req, res) => res.status(204).end());

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });

  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (path: string, viewSessionId: number) => fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "x-view-session-id": String(viewSessionId) },
  });

  for (const path of authPaths) {
    const response = await post(path, 41);
    assert.equal(response.status, 204, `${path} reaches its authentication handler`);
  }

  for (const viewSessionId of [41, 88, 999]) {
    const response = await post("/api/test-academic-write", viewSessionId);
    assert.equal(response.status, 403, `session ${viewSessionId} remains blocked for academic writes`);
    const body = await response.json() as { code?: string };
    assert.equal(body.code, "ARCHIVE_READ_ONLY");
  }

  for (const [method, path] of [
    ["PUT", "/api/login"],
    ["POST", "/api/login/"],
    ["POST", "/api/students/verify/"],
    ["POST", "/api/students/activate/"],
    ["PUT", "/api/students/activate"],
    ["POST", "/api/teacher/change-password/"],
    ["POST", "/api/admin/verify-pin/"],
    ["POST", "/api/admin/change-password"],
    ["POST", "/api/student/change-password"],
  ]) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "x-view-session-id": "41" },
    });
    assert.equal(response.status, 403, `${method} ${path} is not exempt`);
  }
});

test("Teacher password change bypasses only the session guard, not Teacher authentication or password checks", async (t) => {
  const originalPoolQuery = pool.query;
  let revokedQuery = false;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const authenticated = req.get("x-test-teacher-auth") === "true";
    const includeAuthTime = req.get("x-test-auth-time") !== "missing";
    (req as any).session = authenticated
      ? {
          teacherId: 9,
          userId: 7,
          schoolId: 11,
          ...(includeAuthTime ? { authIssuedAt: 1 } : {}),
          destroy: (callback: (error?: Error | null) => void) => callback(null),
        }
      : {};
    next();
  });
  app.use(checkSessionContext);
  registerTeacherRoutes(app);

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    pool.query = originalPoolQuery;
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });

  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/teacher/change-password`;
  const post = (headers: Record<string, string>, body: unknown = {}) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  const unauthenticated = await post({ "x-view-session-id": "41" });
  assert.equal(unauthenticated.status, 401, "the route still requires an authenticated Teacher");

  const malformedSession = await post({
    "x-test-teacher-auth": "true",
    "x-test-auth-time": "missing",
    "x-view-session-id": "41",
  });
  assert.equal(malformedSession.status, 401, "incomplete Teacher sessions are rejected");

  const invalidPassword = await post({
    "x-test-teacher-auth": "true",
    "x-view-session-id": "41",
  }, { currentPassword: "old-password", newPassword: "x" });
  assert.equal(invalidPassword.status, 400, "password validation still runs after the stale-session guard is skipped");

  pool.query = (async () => {
    revokedQuery = true;
    return { rows: [{ revoked_at: "2" }] };
  }) as typeof pool.query;
  const revokedSession = await post({
    "x-test-teacher-auth": "true",
    "x-view-session-id": "41",
  }, { currentPassword: "old-password", newPassword: "new-password" });
  assert.equal(revokedSession.status, 401, "revoked authentication attempts remain rejected");
  assert.equal(revokedQuery, true, "revocation status was checked");
});

test("Principal initialization remains available without an Academic Session and rejects unauthorized setup", async (t) => {
  const originalGetSession = storage.getAcademicSessionById;
  const originalGetUser = storage.getUserById;
  let sessionLookups = 0;
  storage.getAcademicSessionById = async (id: number) => {
    sessionLookups += 1;
    if (id === 41) return { id: 41, schoolId: 11, isActive: false } as any;
    return undefined;
  };
  storage.getUserById = async (id: number) => {
    if (id === 7) return { id, role: "admin", isInitialized: false } as any;
    if (id === 8) return { id, role: "admin", isInitialized: true } as any;
    if (id === 9) return { id, role: "teacher", isInitialized: false } as any;
    return undefined;
  };
  t.after(() => {
    storage.getAcademicSessionById = originalGetSession;
    storage.getUserById = originalGetUser;
  });

  const app = express();
  app.use((req, _res, next) => {
    const pending = req.get("x-test-pending-user");
    const school = req.get("x-test-school");
    (req as any).session = {
      ...(pending ? { pendingInitUserId: Number(pending) } : {}),
      ...(school ? { schoolId: Number(school) } : {}),
    };
    next();
  });
  app.use(checkSessionContext);
  app.post("/api/admin/initialize", requirePendingAdminInitialization, (_req, res) => res.sendStatus(204));

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });

  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (headers: Record<string, string> = {}) => fetch(`${baseUrl}/api/admin/initialize`, {
    method: "POST",
    headers,
  });

  const staleArchivedSession = await post({
    "x-view-session-id": "41",
    "x-test-school": "11",
    "x-test-pending-user": "7",
  });
  assert.equal(staleArchivedSession.status, 204);
  assert.equal(sessionLookups, 0, "the account setup route skips academic-session lookup");

  const noAcademicSession = await post({ "x-test-pending-user": "7" });
  assert.equal(noAcademicSession.status, 204);

  assert.equal((await post()).status, 401, "missing pending-init authentication is rejected");
  assert.equal(
    (await fetch(`${baseUrl}/api/admin/initialize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pendingInitUserId: 7 }),
    })).status,
    401,
    "a client-supplied account ID cannot replace the server-side pending-init session",
  );
  assert.equal((await post({ "x-test-school": "12" })).status, 401, "another school's ordinary session cannot initialize an account");
  assert.equal((await post({ "x-test-pending-user": "9" })).status, 403, "non-admin setup is rejected");
  assert.equal((await post({ "x-test-pending-user": "8" })).status, 403, "already initialized admin setup is rejected");
});
