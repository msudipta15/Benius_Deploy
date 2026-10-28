import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import test from "node:test";
import { registerRoutes } from "./routes/routes";
import { storage } from "./storage";

test("student registration works with a stale archived-session header and preserves identity checks", async (t) => {
  const originalGetSession = storage.getAcademicSessionById;
  const originalFindStudent = storage.getStudentByDsidPhoneDob;
  const originalActivateStudent = storage.activateStudent;
  let sessionLookups = 0;
  let studentFixture: any = {
    id: 70,
    schoolId: 11,
    name: "Fixture Student",
    isActivated: false,
  };
  const activationCalls: Array<{ id: number; passwordHash: string; enrollmentDate?: string }> = [];

  storage.getAcademicSessionById = async () => {
    sessionLookups += 1;
    return { id: 41, schoolId: 11, isActive: false } as any;
  };
  storage.getStudentByDsidPhoneDob = async (dsid: string, phone: string, dob: string) => {
    if (dsid === "FIXTURE-70" && phone === "9876543210" && dob === "2010-01-02") {
      return studentFixture;
    }
    return undefined;
  };
  storage.activateStudent = async (id: number, passwordHash: string, enrollmentDate?: string) => {
    activationCalls.push({ id, passwordHash, enrollmentDate });
    return studentFixture;
  };

  t.after(() => {
    storage.getAcademicSessionById = originalGetSession;
    storage.getStudentByDsidPhoneDob = originalFindStudent;
    storage.activateStudent = originalActivateStudent;
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Simulate a signed-in user from one school whose browser retains an
    // archived view-session selection; registration remains identity-scoped.
    (req as any).session = { schoolId: 11 };
    next();
  });
  const server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });

  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-view-session-id": "41",
    },
    body: JSON.stringify(body),
  });
  const identity = {
    dsid: "FIXTURE-70",
    phone: "9876543210",
    dob: "2010-01-02",
  };

  const verified = await post("/api/students/verify", identity);
  assert.equal(verified.status, 200, "identity verification is not blocked by the stale archived session");

  const invalidIdentity = await post("/api/students/verify", {
    ...identity,
    phone: "0000000000",
  });
  assert.equal(invalidIdentity.status, 404, "mismatched identity details are rejected");

  const invalidPassword = await post("/api/students/activate", {
    ...identity,
    password: "short",
  });
  assert.equal(invalidPassword.status, 400, "invalid activation password is rejected");

  const activated = await post("/api/students/activate", {
    ...identity,
    password: "fixture-only-password",
    schoolId: 999,
  });
  assert.equal(activated.status, 200, "activation uses the matching Student record, not a browser-supplied school ID");
  assert.equal(activationCalls.length, 1);
  assert.equal(activationCalls[0].id, 70);
  assert.ok(activationCalls[0].passwordHash !== "fixture-only-password");
  assert.ok(activationCalls[0].enrollmentDate);
  assert.equal(sessionLookups, 0, "the exact registration routes do not resolve or write an Academic Session");

  studentFixture = { ...studentFixture, isActivated: true };
  const duplicateActivation = await post("/api/students/activate", {
    ...identity,
    password: "fixture-only-password",
  });
  assert.equal(duplicateActivation.status, 409, "already-activated accounts cannot be activated again");
  assert.equal(activationCalls.length, 1, "duplicate activation performs no account update");
});
