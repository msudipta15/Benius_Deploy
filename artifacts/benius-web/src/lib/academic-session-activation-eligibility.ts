export interface ActivationSession {
  id: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
  status: string;
}

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function getNextSessionEligibleForActivation(
  sessions: ActivationSession[],
): number | null {
  if (sessions.length === 0 || sessions.some((session) =>
    !validDateOnly(session.startDate)
    || !validDateOnly(session.endDate)
    || session.startDate >= session.endDate
  )) return null;

  const ordered = [...sessions].sort((a, b) =>
    a.startDate.localeCompare(b.startDate) || a.id - b.id,
  );
  for (let index = 0; index < ordered.length; index += 1) {
    if (index > 0 && (
      ordered[index - 1].startDate === ordered[index].startDate
      || ordered[index].startDate <= ordered[index - 1].endDate
    )) return null;
  }

  const active = ordered.filter((session) => session.isActive);
  if (active.length === 0) {
    return ordered.length === 1 && ordered[0].status === "draft"
      ? ordered[0].id
      : null;
  }
  if (active.length !== 1 || active[0].status !== "active"
    || ordered.some((session) => !session.isActive && session.status === "active")) return null;

  const activeIndex = ordered.findIndex((session) => session.isActive);
  const next = ordered[activeIndex + 1];
  return next?.status === "draft" ? next.id : null;
}
