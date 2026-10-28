import assert from "node:assert/strict";
import test from "node:test";
import { resolveTimetableSessionId } from "./teacher-routes";
import { storage } from "./storage";

test("Development Bell Structure diagnostics report school/session mismatch without sensitive headers", async (t) => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLookup = storage.getAcademicSessionForSchool;
  const originalInfo = console.info;
  const messages: string[] = [];

  process.env.NODE_ENV = "development";
  storage.getAcademicSessionForSchool = async () => undefined;
  console.info = (...args: unknown[]) => messages.push(args.map(String).join(" "));
  t.after(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    storage.getAcademicSessionForSchool = originalLookup;
    console.info = originalInfo;
  });

  let status = 200;
  let responseBody: unknown;
  const result = await resolveTimetableSessionId(
    {
      method: "GET",
      path: "/api/timetable/structure",
      headers: {
        "x-view-session-id": "57",
        cookie: "must-not-be-logged",
        authorization: "must-not-be-logged",
      },
    } as any,
    {
      status(code: number) {
        status = code;
        return this;
      },
      json(body: unknown) {
        responseBody = body;
        return this;
      },
    } as any,
    41,
  );

  assert.equal(result, null);
  assert.equal(status, 403);
  assert.deepEqual(responseBody, { message: "Academic session does not belong to this school" });
  assert.equal(messages.length, 1);
  assert.match(messages[0], /^\[TEMP bell-structure-session\] /);
  const diagnostic = JSON.parse(messages[0].replace(/^\[TEMP bell-structure-session\] /, ""));
  assert.deepEqual(diagnostic, {
    schoolId: 41,
    headerPresent: true,
    parsedSessionId: 57,
    lookupSucceeded: false,
    matchedSchoolId: null,
    validationBranch: "selected-session-not-found-for-authenticated-school",
  });
  assert.equal(messages[0].includes("must-not-be-logged"), false);
});

test("Bell Structure diagnostics confirm a matching session and stay off for other paths and Production", async (t) => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLookup = storage.getAcademicSessionForSchool;
  const originalInfo = console.info;
  const messages: string[] = [];
  process.env.NODE_ENV = "development";
  storage.getAcademicSessionForSchool = async (id, schoolId) =>
    id === 57 && schoolId === 41
      ? ({ id: 57, schoolId: 41, isActive: true } as any)
      : undefined;
  console.info = (...args: unknown[]) => messages.push(args.map(String).join(" "));
  t.after(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    storage.getAcademicSessionForSchool = originalLookup;
    console.info = originalInfo;
  });

  const response = { status: () => response, json: () => response } as any;
  const selectedSession = await resolveTimetableSessionId({
    method: "GET",
    path: "/api/timetable/structure",
    headers: { "x-view-session-id": "57" },
  } as any, response, 41);
  assert.equal(selectedSession, 57);
  assert.match(messages[0], /"matchedSchoolId":41/);
  assert.match(messages[0], /"validationBranch":"selected-session-accepted"/);

  const afterMatchCount = messages.length;
  await resolveTimetableSessionId({
    method: "GET",
    path: "/api/timetable/class-view",
    headers: { "x-view-session-id": "57" },
  } as any, response, 41);
  assert.equal(messages.length, afterMatchCount, "other Timetable endpoints do not emit temporary diagnostics");

  process.env.NODE_ENV = "production";
  await resolveTimetableSessionId({
    method: "GET",
    path: "/api/timetable/structure",
    headers: { "x-view-session-id": "57" },
  } as any, response, 41);
  assert.equal(messages.length, afterMatchCount, "Production emits no Bell Structure diagnostics");
});
