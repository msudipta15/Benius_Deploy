import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAcademicSessionActivationPlan,
  canManageAcademicSession,
  getSessionActivationBlockReason,
} from "./academic-session-activation";

const placementMetadata = [
  { metaKey: "classes", metaValue: '["5","6"]' },
  { metaKey: "sections", metaValue: '["A","B"]' },
  { metaKey: "class_sections", metaValue: '{"5":["A"],"6":["B"]}' },
];

const forwardSessions = [
  { id: 9, startDate: "2035-04-01", endDate: "2036-03-31", isActive: true, status: "active" },
  { id: 10, startDate: "2036-04-01", endDate: "2037-03-31", isActive: false, status: "draft" },
];

test("activation takes current placement from one valid target-session Active enrollment", () => {
  const plan = buildAcademicSessionActivationPlan({
    sessionId: 10,
    sessionName: "Target",
    schoolSessions: forwardSessions,
    activeStudents: [{
      id: 1, isActive: true, class: "5", section: "A", rollNumber: 12,
    }],
    targetEnrollments: [{
      studentId: 1, className: "6", sectionName: "B", rollNo: null, status: "Active",
    }],
    sameSchoolStudentStates: [{ id: 1, isActive: true }],
    placementMetadata,
  });

  assert.equal(plan.preview.canActivate, true);
  assert.equal(plan.preview.studentsNeedingRegistryUpdate, 1);
  assert.deepEqual(plan.placements, [{
    studentId: 1,
    className: "6",
    sectionName: "B",
    rollNo: null,
    placementChanged: true,
  }]);
});

test("missing enrollments, duplicate rows, foreign Students, and invalid placement block activation", () => {
  const plan = buildAcademicSessionActivationPlan({
    sessionId: 10,
    sessionName: "Target",
    schoolSessions: forwardSessions,
    activeStudents: [
      { id: 1, isActive: true, class: "5", section: "A", rollNumber: 1 },
      { id: 2, isActive: true, class: "5", section: "A", rollNumber: 2 },
      { id: 3, isActive: true, class: "5", section: "A", rollNumber: 3 },
    ],
    targetEnrollments: [
      { studentId: 1, className: "6", sectionName: "B", rollNo: 10, status: "Active" },
      { studentId: 1, className: "6", sectionName: "B", rollNo: 11, status: "Active" },
      { studentId: 2, className: "99", sectionName: "A", rollNo: 20, status: "Active" },
      { studentId: 99, className: "6", sectionName: "B", rollNo: 30, status: "Active" },
    ],
    sameSchoolStudentStates: [
      { id: 1, isActive: true },
      { id: 2, isActive: true },
    ],
    placementMetadata,
  });

  assert.equal(plan.preview.canActivate, false);
  assert.equal(plan.preview.activeStudentsMissingTargetEnrollment, 1);
  assert.equal(plan.preview.duplicateActiveEnrollmentConflicts, 1);
  assert.equal(plan.preview.foreignOrMissingStudentEnrollments, 1);
  assert.equal(plan.preview.invalidTargetPlacements, 1);
});

test("inactive Students are counted as skipped and never enter the synchronization plan", () => {
  const plan = buildAcademicSessionActivationPlan({
    sessionId: 10,
    sessionName: "Target",
    schoolSessions: forwardSessions,
    activeStudents: [],
    targetEnrollments: [{
      studentId: 7, className: "6", sectionName: "B", rollNo: 44, status: "Active",
    }],
    sameSchoolStudentStates: [{ id: 7, isActive: false }],
    placementMetadata,
  });

  assert.equal(plan.preview.canActivate, true);
  assert.equal(plan.preview.inactiveStudentsSkipped, 1);
  assert.deepEqual(plan.placements, []);
});

test("first-session activation is allowed only for the sole unambiguous Draft session", () => {
  assert.equal(getSessionActivationBlockReason([
    { id: 1, startDate: "2035-04-01", endDate: "2036-03-31", isActive: false, status: "draft" },
  ], 1), null);
  assert.match(getSessionActivationBlockReason([
    { id: 1, startDate: "2035-04-01", endDate: "2036-03-31", isActive: false, status: "draft" },
    { id: 2, startDate: "2036-04-01", endDate: "2037-03-31", isActive: false, status: "draft" },
  ], 1) ?? "", /multiple sessions/i);
});

test("archived historical sessions and skipped future sessions are blocked", () => {
  assert.match(getSessionActivationBlockReason([
    { id: 1, startDate: "2034-04-01", endDate: "2035-03-31", isActive: false, status: "archived" },
    { id: 2, startDate: "2035-04-01", endDate: "2036-03-31", isActive: true, status: "active" },
    { id: 3, startDate: "2036-04-01", endDate: "2037-03-31", isActive: false, status: "draft" },
  ], 1) ?? "", /archived/i);
  assert.match(getSessionActivationBlockReason([
    { id: 2, startDate: "2035-04-01", endDate: "2036-03-31", isActive: true, status: "active" },
    { id: 3, startDate: "2036-04-01", endDate: "2037-03-31", isActive: false, status: "draft" },
    { id: 4, startDate: "2037-04-01", endDate: "2038-03-31", isActive: false, status: "draft" },
  ], 4) ?? "", /immediate next/i);
  assert.match(getSessionActivationBlockReason(forwardSessions, 9) ?? "", /already active/i);
});

test("invalid, duplicate, overlapping, and missing-session chronologies fail closed", () => {
  assert.match(getSessionActivationBlockReason([
    { id: 1, startDate: "2035-04-01", endDate: "2036-04-01", isActive: true, status: "active" },
    { id: 2, startDate: "2036-04-01", endDate: "2037-03-31", isActive: false, status: "draft" },
  ], 2) ?? "", /overlap/i);
  assert.match(getSessionActivationBlockReason([
    { id: 1, startDate: "2035-04-01", endDate: "2036-03-31", isActive: true, status: "active" },
    { id: 2, startDate: "2035-04-01", endDate: "2037-03-31", isActive: false, status: "draft" },
  ], 2) ?? "", /same start date/i);
  assert.match(getSessionActivationBlockReason([
    { id: 1, startDate: "2035-02-30", endDate: "2036-03-31", isActive: true, status: "active" },
    { id: 2, startDate: "2036-04-01", endDate: "2037-03-31", isActive: false, status: "draft" },
  ], 2) ?? "", /invalid/i);
  assert.match(getSessionActivationBlockReason(forwardSessions, 99) ?? "", /not available/i);
});

test("only an Admin may manage session activation", () => {
  assert.equal(canManageAcademicSession("admin"), true);
  assert.equal(canManageAcademicSession("support_staff"), false);
  assert.equal(canManageAcademicSession("teacher"), false);
  assert.equal(canManageAcademicSession(null), false);
});
