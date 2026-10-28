import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import { StudentSessionProvider } from "@/contexts/student-session-provider";

import NotFound from "@/pages/not-found";
import Home from "@/pages/home";

// Core dashboards — eager-loaded so there is zero Suspense delay after login
import AdminDashboard  from "@/pages/admin-dashboard";
import TeacherDashboard from "@/pages/teacher-dashboard";
import Login           from "@/pages/login";
import StudentLogin    from "@/pages/student-login";
import TeacherLogin    from "@/pages/teacher-login";
import StudentForgotPassword from "@/pages/student-forgot-password";

const SessionCopyCenter       = lazy(() => import("@/pages/session-copy-center"));
const SessionMigration        = lazy(() => import("@/pages/admin-modules/session-migration"));
const DeactivatedStudentsPage = lazy(() => import("@/pages/admin-modules/deactivated-students"));

// Everything else stays lazy — only downloaded when first visited
const SuperMaster         = lazy(() => import("@/pages/super-master"));
const SuperMasterLogin    = lazy(() => import("@/pages/super-master-login"));
const Register            = lazy(() => import("@/pages/register"));
const AdminSetup          = lazy(() => import("@/pages/admin-setup"));
const StudentDashboard    = lazy(() => import("@/pages/student-dashboard"));
const StudentProfilePage  = lazy(() => import("@/pages/student-profile"));
const StudentAttendance   = lazy(() => import("@/pages/student-attendance"));
const StudentHomework     = lazy(() => import("@/pages/student-homework"));
const StudentClasswork    = lazy(() => import("@/pages/student-classwork"));
const StudentExamination  = lazy(() => import("@/pages/student-examination"));
const StudentComplaints   = lazy(() => import("@/pages/student-complaints"));
const StudentGallery      = lazy(() => import("@/pages/student-gallery"));
const StudentFaculty      = lazy(() => import("@/pages/student-faculty"));
const StudentCalendar     = lazy(() => import("@/pages/student-calendar"));
const StudentTimetable    = lazy(() => import("@/pages/student-timetable"));
const StudentLeave        = lazy(() => import("@/pages/student-leave"));
const StudentNoticeboard  = lazy(() => import("@/pages/student-noticeboard"));
const StudentFees         = lazy(() => import("@/pages/student-fees"));
const StudentArchives     = lazy(() => import("@/pages/student-archives"));
const StudentLibrary      = lazy(() => import("@/pages/student-library"));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#080c14" }}>
      <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
    </div>
  );
}

function TeacherRedirect({ module }: { module?: string }) {
  const [, nav] = useLocation();
  if (module) nav(`/teacher-dashboard/${module}`);
  else nav("/teacher-dashboard");
  return null;
}

function isSuperAdminPath(path: string) {
  return path === "/super-master" || path.startsWith("/super-master/");
}

async function revokeSuperAdminForNavigation() {
  let session = queryClient.getQueryData<{ csrfToken?: string }>(["/api/super-admin/session"]);
  if (!session?.csrfToken) {
    const check = await fetch("/api/super-admin/session", { credentials: "include", cache: "no-store" });
    if (check.status === 401) return;
    if (!check.ok) throw new Error("Could not verify the Super Admin session.");
    session = await check.json();
  }
  const csrfToken = session?.csrfToken;
  if (!csrfToken) throw new Error("Super Admin logout token is unavailable.");
  const response = await fetch("/api/super-admin/logout", {
    method: "POST",
    credentials: "include",
    headers: { "X-Super-Admin-CSRF": csrfToken },
  });
  if (response.status !== 401 && !response.ok) throw new Error("Server logout did not complete.");
  queryClient.removeQueries({ queryKey: ["/api/super-admin/session"], exact: true });
  queryClient.removeQueries({ queryKey: ["/api/schools"], exact: true });
}

function Router() {
  const [path] = useLocation();
  const currentPath = useRef(path);
  const previousPath = useRef(path);
  const [exitPending, setExitPending] = useState(false);
  const [exitError, setExitError] = useState("");
  const leavingSuperAdmin = isSuperAdminPath(previousPath.current) && !isSuperAdminPath(path);
  currentPath.current = path;

  const retrySuperAdminExit = () => {
    setExitError("");
    setExitPending(false);
  };

  useEffect(() => {
    if (!leavingSuperAdmin || exitPending || exitError) return;
    setExitPending(true);
    void revokeSuperAdminForNavigation()
      .then(() => {
        previousPath.current = currentPath.current;
      })
      .catch((error: unknown) => {
        setExitError(error instanceof Error ? error.message : "Server logout failed.");
      })
      .finally(() => setExitPending(false));
  }, [leavingSuperAdmin, exitPending, exitError]);

  if (leavingSuperAdmin || exitPending || exitError) {
    return (
      <main className="min-h-screen grid place-items-center p-6" role="status" aria-live="polite">
        <div className="max-w-md space-y-4 text-center">
          <p>{exitError ? `Super Admin logout failed: ${exitError}` : "Ending Super Admin session securely…"}</p>
          {exitError ? <button type="button" onClick={retrySuperAdminExit}>Retry logout</button> : null}
        </div>
      </main>
    );
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/super-master/login" component={SuperMasterLogin} />
        <Route path="/super-master" component={SuperMaster} />
        <Route path="/login" component={Login} />
        <Route path="/admin-setup" component={AdminSetup} />
        <Route path="/admin-dashboard" component={AdminDashboard} />
        <Route path="/admin-dashboard/student-registry/deactivated" component={DeactivatedStudentsPage} />
        <Route path="/admin-dashboard/school-setup/session-migration" component={SessionMigration} />
        <Route path="/admin-dashboard/school-setup/:tab" component={AdminDashboard} />
        <Route path="/admin-dashboard/timetable/:tab" component={AdminDashboard} />
        <Route path="/admin-dashboard/approval-center/:tab" component={AdminDashboard} />
        <Route path="/admin-dashboard/leave-requests/:tab" component={AdminDashboard} />
        <Route path="/admin-dashboard/complaint-hub/:tab" component={AdminDashboard} />
        <Route path="/admin-dashboard/analytics/:tab" component={AdminDashboard} />
        <Route path="/admin-dashboard/id-card-gen/:tab" component={AdminDashboard} />
        <Route path="/admin-dashboard/:module" component={AdminDashboard} />
        <Route path="/register" component={Register} />
        <Route path="/student-login" component={StudentLogin} />
        <Route path="/student/forgot-password" component={StudentForgotPassword} />
        <Route path="/student/forgot-password/otp" component={StudentForgotPassword} />
        <Route path="/student/forgot-password/reset" component={StudentForgotPassword} />
        <Route path="/student-dashboard" component={StudentDashboard} />
        <Route path="/student-profile" component={StudentProfilePage} />
        <Route path="/student/attendance" component={StudentAttendance} />
        <Route path="/student/homework" component={StudentHomework} />
        <Route path="/student/classwork" component={StudentClasswork} />
        <Route path="/student/examination" component={StudentExamination} />
        <Route path="/student/complaints" component={StudentComplaints} />
        <Route path="/student/gallery" component={StudentGallery} />
        <Route path="/student/faculty" component={StudentFaculty} />
        <Route path="/student/calendar" component={StudentCalendar} />
        <Route path="/student/timetable" component={StudentTimetable} />
        <Route path="/student/leave" component={StudentLeave} />
        <Route path="/student/noticeboard" component={StudentNoticeboard} />
        <Route path="/student/fees" component={StudentFees} />
        <Route path="/student/archives" component={StudentArchives} />
        <Route path="/student/library" component={StudentLibrary} />
        <Route path="/teacher-login" component={TeacherLogin} />
        <Route path="/teacher-dashboard" component={TeacherDashboard} />
        <Route path="/teacher-dashboard/:module" component={TeacherDashboard} />
        <Route path="/teacher/dashboard/:module">
          {(params) => <TeacherRedirect module={params.module} />}
        </Route>
        <Route path="/teacher/dashboard">
          {() => <TeacherRedirect />}
        </Route>
        <Route path="/session-copy-center/:sessionId" component={SessionCopyCenter} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <StudentSessionProvider>
            <Router />
          </StudentSessionProvider>
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
