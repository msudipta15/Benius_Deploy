import { and, eq, inArray, sql } from "drizzle-orm";
import {
  academicSessions,
  enrollments,
  schoolMetadata,
  students,
  type AcademicSession,
} from "@workspace/db";
import { db } from "./db";
import {
  hasActiveStudentPlacementChanged,
  isConfiguredStudentPlacement,
  type StudentRegistryPlacementMetadata,
} from "./student-registry-placement";

export type AcademicSessionActivationTransaction =
  Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ActivationStudentSnapshot {
  id: number;
  isActive: boolean;
  class: string;
  section: string;
  rollNumber: number | null;
}

export interface ActivationEnrollmentSnapshot {
  studentId: number;
  className: string;
  sectionName: string;
  rollNo: number | null;
  status: string;
}

export interface ActivationStudentState {
  id: number;
  isActive: boolean;
}

export interface ActivationSessionSnapshot {
  id: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
  status: string;
}

export interface ActivationPlacementCandidate {
  studentId: number;
  className: string;
  sectionName: string;
  rollNo: number | null;
  placementChanged: boolean;
}

export interface AcademicSessionActivationPreview {
  sessionId: number;
  sessionName: string;
  activeStudents: number;
  activeTargetSessionEnrollments: number;
  activeTargetEnrollmentsForActiveStudents: number;
  activeStudentsMissingTargetEnrollment: number;
  inactiveStudentsSkipped: number;
  studentsReadyToSynchronize: number;
  studentsNeedingRegistryUpdate: number;
  studentsWithUnchangedPlacement: number;
  duplicateActiveEnrollmentConflicts: number;
  foreignOrMissingStudentEnrollments: number;
  invalidTargetPlacements: number;
  eligibilityBlockReason: string | null;
  canActivate: boolean;
}

export interface AcademicSessionActivationPlan {
  preview: AcademicSessionActivationPreview;
  placements: ActivationPlacementCandidate[];
}

export interface AcademicSessionActivationSummary {
  activeStudents: number;
  activeTargetSessionEnrollments: number;
  studentsSynchronized: number;
  studentsUpdated: number;
  studentsUnchanged: number;
  inactiveStudentsSkipped: number;
}

export interface AcademicSessionActivationResult {
  session: AcademicSession;
  summary: AcademicSessionActivationSummary;
}

export class AcademicSessionActivationNotFoundError extends Error {
  readonly code = "ACADEMIC_SESSION_NOT_FOUND";

  constructor() {
    super("Academic session not found for this school.");
    this.name = "AcademicSessionActivationNotFoundError";
  }
}

export class AcademicSessionActivationBlockedError extends Error {
  readonly code: string;

  constructor(readonly preview: AcademicSessionActivationPreview) {
    const reasons: string[] = [];
    if (preview.activeStudentsMissingTargetEnrollment > 0) {
      reasons.push(
        `${preview.activeStudentsMissingTargetEnrollment} active Student${preview.activeStudentsMissingTargetEnrollment === 1 ? "" : "s"} missing an Active enrollment in this session`,
      );
    }
    if (preview.duplicateActiveEnrollmentConflicts > 0) {
      reasons.push(
        `${preview.duplicateActiveEnrollmentConflicts} Student${preview.duplicateActiveEnrollmentConflicts === 1 ? "" : "s"} with duplicate Active target enrollments`,
      );
    }
    if (preview.foreignOrMissingStudentEnrollments > 0) {
      reasons.push(
        `${preview.foreignOrMissingStudentEnrollments} Active target enrollment${preview.foreignOrMissingStudentEnrollments === 1 ? "" : "s"} linked to a missing or different-school Student`,
      );
    }
    if (preview.invalidTargetPlacements > 0) {
      reasons.push(
        `${preview.invalidTargetPlacements} Active target enrollment${preview.invalidTargetPlacements === 1 ? "" : "s"} with an unconfigured class/section`,
      );
    }

    super(
      `Cannot activate this session: ${reasons.join("; ")}. No session or Student Registry changes were made.`,
    );
    this.name = "AcademicSessionActivationBlockedError";
    this.code = preview.activeStudentsMissingTargetEnrollment > 0
      && preview.duplicateActiveEnrollmentConflicts === 0
      && preview.foreignOrMissingStudentEnrollments === 0
      && preview.invalidTargetPlacements === 0
      ? "MISSING_TARGET_ENROLLMENTS"
      : "ACADEMIC_SESSION_ACTIVATION_BLOCKED";
  }
}

export function canManageAcademicSession(role: unknown): boolean {
  return role === "admin";
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function getSessionActivationBlockReason(
  sessions: ActivationSessionSnapshot[],
  targetSessionId: number,
): string | null {
  if (sessions.length === 0 || !sessions.some((session) => session.id === targetSessionId)) {
    return "The target session is not available in this school.";
  }
  if (sessions.some((session) =>
    !isValidDateOnly(session.startDate)
    || !isValidDateOnly(session.endDate)
    || session.startDate >= session.endDate
  )) {
    return "Session dates are missing or invalid; activation is blocked until the school session timeline is corrected.";
  }

  const sorted = [...sessions].sort((a, b) =>
    a.startDate.localeCompare(b.startDate) || a.id - b.id,
  );
  for (let index = 0; index < sorted.length; index += 1) {
    if (index > 0 && sorted[index - 1].startDate === sorted[index].startDate) {
      return "Multiple sessions have the same start date; the next session cannot be determined safely.";
    }
    if (index > 0 && sorted[index].startDate <= sorted[index - 1].endDate) {
      return "Academic session dates overlap; activation is blocked until the timeline is unambiguous.";
    }
  }

  const activeSessions = sorted.filter((session) => session.isActive);
  if (activeSessions.length === 0) {
    return sessions.length === 1
      && sessions[0].id === targetSessionId
      && sessions[0].status === "draft"
      ? null
      : "No active session exists and the school has multiple sessions; first-session activation is ambiguous.";
  }
  if (activeSessions.length !== 1 || activeSessions[0].status !== "active"
    || sorted.some((session) => !session.isActive && session.status === "active")) {
    return "Active session status is inconsistent; activation is blocked until the school session state is reviewed.";
  }

  const target = sorted.find((session) => session.id === targetSessionId)!;
  if (target.isActive) return "This session is already active.";
  if (target.status !== "draft") {
    return "Only the immediate next Draft session can be activated; archived sessions remain read-only.";
  }

  const activeIndex = sorted.findIndex((session) => session.isActive);
  const nextSession = sorted[activeIndex + 1];
  if (!nextSession) return "There is no next chronological session to activate.";
  if (nextSession.id !== targetSessionId) {
    return activeIndex > sorted.findIndex((session) => session.id === targetSessionId)
      ? "Previous or archived sessions cannot be reactivated through normal activation."
      : "Only the immediate next chronological session can be activated; later sessions cannot skip ahead.";
  }
  return null;
}

export function buildAcademicSessionActivationPlan(input: {
  sessionId: number;
  sessionName: string;
  schoolSessions: ActivationSessionSnapshot[];
  activeStudents: ActivationStudentSnapshot[];
  targetEnrollments: ActivationEnrollmentSnapshot[];
  sameSchoolStudentStates: ActivationStudentState[];
  placementMetadata: StudentRegistryPlacementMetadata[];
}): AcademicSessionActivationPlan {
  const sameSchoolStudents = new Map(
    input.sameSchoolStudentStates.map((student) => [student.id, student]),
  );
  const activeStudents = new Map(
    input.activeStudents.map((student) => [student.id, student]),
  );
  const activeTargetEnrollments = input.targetEnrollments.filter(
    (enrollment) => enrollment.status === "Active",
  );
  const activeEnrollmentGroups = new Map<number, ActivationEnrollmentSnapshot[]>();

  for (const enrollment of activeTargetEnrollments) {
    const group = activeEnrollmentGroups.get(enrollment.studentId) ?? [];
    group.push(enrollment);
    activeEnrollmentGroups.set(enrollment.studentId, group);
  }

  const duplicateActiveEnrollmentConflicts = Array.from(activeEnrollmentGroups.values())
    .filter((group) => group.length > 1).length;
  const foreignOrMissingStudentEnrollments = activeTargetEnrollments.filter(
    (enrollment) => !sameSchoolStudents.has(enrollment.studentId),
  ).length;
  const activeTargetSessionEnrollments = activeTargetEnrollments.filter(
    (enrollment) => sameSchoolStudents.has(enrollment.studentId),
  ).length;
  const activeTargetEnrollmentsForActiveStudents = new Set(
    activeTargetEnrollments
      .filter((enrollment) => activeStudents.has(enrollment.studentId))
      .map((enrollment) => enrollment.studentId),
  ).size;
  const inactiveStudentsSkipped = new Set(
    activeTargetEnrollments
      .filter((enrollment) => {
        const student = sameSchoolStudents.get(enrollment.studentId);
        return student !== undefined && !student.isActive;
      })
      .map((enrollment) => enrollment.studentId),
  ).size;
  const invalidTargetPlacements = activeTargetEnrollments.filter((enrollment) =>
    sameSchoolStudents.has(enrollment.studentId)
    && !isConfiguredStudentPlacement(
      input.placementMetadata,
      enrollment.className,
      enrollment.sectionName,
    ),
  ).length;

  let activeStudentsMissingTargetEnrollment = 0;
  const placements: ActivationPlacementCandidate[] = [];

  for (const student of input.activeStudents) {
    const studentEnrollments = activeEnrollmentGroups.get(student.id) ?? [];
    if (studentEnrollments.length === 0) {
      activeStudentsMissingTargetEnrollment += 1;
      continue;
    }
    if (studentEnrollments.length !== 1) continue;

    const enrollment = studentEnrollments[0];
    if (!isConfiguredStudentPlacement(
      input.placementMetadata,
      enrollment.className,
      enrollment.sectionName,
    )) {
      continue;
    }

    placements.push({
      studentId: student.id,
      className: enrollment.className,
      sectionName: enrollment.sectionName,
      rollNo: enrollment.rollNo,
      placementChanged: hasActiveStudentPlacementChanged(student, {
        class: enrollment.className,
        section: enrollment.sectionName,
        rollNumber: enrollment.rollNo,
      }),
    });
  }

  const studentsNeedingRegistryUpdate = placements.filter(
    (placement) => placement.placementChanged,
  ).length;
  const eligibilityBlockReason = getSessionActivationBlockReason(
    input.schoolSessions,
    input.sessionId,
  );
  const preview: AcademicSessionActivationPreview = {
    sessionId: input.sessionId,
    sessionName: input.sessionName,
    activeStudents: input.activeStudents.length,
    activeTargetSessionEnrollments,
    activeTargetEnrollmentsForActiveStudents,
    activeStudentsMissingTargetEnrollment,
    inactiveStudentsSkipped,
    studentsReadyToSynchronize: placements.length,
    studentsNeedingRegistryUpdate,
    studentsWithUnchangedPlacement: placements.length - studentsNeedingRegistryUpdate,
    duplicateActiveEnrollmentConflicts,
    foreignOrMissingStudentEnrollments,
    invalidTargetPlacements,
    eligibilityBlockReason,
    canActivate:
      eligibilityBlockReason === null
      &&
      activeStudentsMissingTargetEnrollment === 0
      && duplicateActiveEnrollmentConflicts === 0
      && foreignOrMissingStudentEnrollments === 0
      && invalidTargetPlacements === 0,
  };

  return { preview, placements };
}

export async function inspectAcademicSessionActivation(
  tx: AcademicSessionActivationTransaction,
  sessionId: number,
  schoolId: number,
  lockForActivation = false,
): Promise<{
  session: AcademicSession;
  plan: AcademicSessionActivationPlan;
}> {
  if (lockForActivation) {
    // Serialize activation transitions for this school without a schema change.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${schoolId}, 0)`);
    await tx
      .select({ id: academicSessions.id })
      .from(academicSessions)
      .where(eq(academicSessions.schoolId, schoolId))
      .orderBy(academicSessions.id)
      .for("update");
  }

  const [session] = await tx
    .select()
    .from(academicSessions)
    .where(and(
      eq(academicSessions.id, sessionId),
      eq(academicSessions.schoolId, schoolId),
    ))
    .limit(1);
  if (!session) throw new AcademicSessionActivationNotFoundError();

  const schoolSessions = await tx
    .select({
      id: academicSessions.id,
      startDate: academicSessions.startDate,
      endDate: academicSessions.endDate,
      isActive: academicSessions.isActive,
      status: academicSessions.status,
    })
    .from(academicSessions)
    .where(eq(academicSessions.schoolId, schoolId))
    .orderBy(academicSessions.startDate, academicSessions.id);

  const activeStudents = lockForActivation
    ? await tx
      .select({
        id: students.id,
        isActive: students.isActive,
        class: students.class,
        section: students.section,
        rollNumber: students.rollNumber,
      })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.isActive, true)))
      .orderBy(students.id)
      .for("update")
    : await tx
      .select({
        id: students.id,
        isActive: students.isActive,
        class: students.class,
        section: students.section,
        rollNumber: students.rollNumber,
      })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.isActive, true)))
      .orderBy(students.id);

  const targetEnrollments = lockForActivation
    ? await tx
      .select({
        studentId: enrollments.studentId,
        className: enrollments.className,
        sectionName: enrollments.sectionName,
        rollNo: enrollments.rollNo,
        status: enrollments.status,
      })
      .from(enrollments)
      .where(and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
      ))
      .orderBy(enrollments.studentId, enrollments.id)
      .for("update")
    : await tx
      .select({
        studentId: enrollments.studentId,
        className: enrollments.className,
        sectionName: enrollments.sectionName,
        rollNo: enrollments.rollNo,
        status: enrollments.status,
      })
      .from(enrollments)
      .where(and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
      ))
      .orderBy(enrollments.studentId, enrollments.id);

  const targetStudentIds = [...new Set(
    targetEnrollments
      .filter((enrollment) => enrollment.status === "Active")
      .map((enrollment) => enrollment.studentId),
  )];
  const sameSchoolStudentStates = targetStudentIds.length === 0
    ? []
    : lockForActivation
      ? await tx
        .select({ id: students.id, isActive: students.isActive })
        .from(students)
        .where(and(
          eq(students.schoolId, schoolId),
          inArray(students.id, targetStudentIds),
        ))
        .orderBy(students.id)
        .for("update")
      : await tx
        .select({ id: students.id, isActive: students.isActive })
        .from(students)
        .where(and(
          eq(students.schoolId, schoolId),
          inArray(students.id, targetStudentIds),
        ))
        .orderBy(students.id);

  const placementMetadata = await tx
    .select({
      metaKey: schoolMetadata.metaKey,
      metaValue: schoolMetadata.metaValue,
    })
    .from(schoolMetadata)
    .where(and(
      eq(schoolMetadata.schoolId, schoolId),
      inArray(schoolMetadata.metaKey, ["classes", "sections", "class_sections"]),
    ));

  return {
    session,
    plan: buildAcademicSessionActivationPlan({
      sessionId,
      sessionName: session.sessionName,
      schoolSessions,
      activeStudents,
      targetEnrollments,
      sameSchoolStudentStates,
      placementMetadata,
    }),
  };
}

export async function activateAcademicSessionInTransaction(
  tx: AcademicSessionActivationTransaction,
  sessionId: number,
  schoolId: number,
): Promise<AcademicSessionActivationResult> {
  const { plan } = await inspectAcademicSessionActivation(tx, sessionId, schoolId, true);
  if (!plan.preview.canActivate) {
    throw new AcademicSessionActivationBlockedError(plan.preview);
  }

  // No session or Student writes occur until every target placement is valid.
  await tx
    .update(academicSessions)
    .set({ isActive: false, status: "archived" })
    .where(eq(academicSessions.schoolId, schoolId));

  const [session] = await tx
    .update(academicSessions)
    .set({ isActive: true, status: "active" })
    .where(and(
      eq(academicSessions.id, sessionId),
      eq(academicSessions.schoolId, schoolId),
    ))
    .returning();
  if (!session) throw new AcademicSessionActivationNotFoundError();

  let studentsUpdated = 0;
  for (const placement of plan.placements) {
    if (!placement.placementChanged) continue;
    const [updatedStudent] = await tx
      .update(students)
      .set({
        class: placement.className,
        section: placement.sectionName,
        rollNumber: placement.rollNo,
        idCardPendingReissue: true,
      })
      .where(and(
        eq(students.id, placement.studentId),
        eq(students.schoolId, schoolId),
        eq(students.isActive, true),
      ))
      .returning({ id: students.id });
    if (!updatedStudent) {
      throw new Error("Student placement changed during session activation; all changes were rolled back.");
    }
    studentsUpdated += 1;
  }

  return {
    session,
    summary: {
      activeStudents: plan.preview.activeStudents,
      activeTargetSessionEnrollments: plan.preview.activeTargetSessionEnrollments,
      studentsSynchronized: plan.preview.studentsReadyToSynchronize,
      studentsUpdated,
      studentsUnchanged: plan.preview.studentsWithUnchangedPlacement,
      inactiveStudentsSkipped: plan.preview.inactiveStudentsSkipped,
    },
  };
}
