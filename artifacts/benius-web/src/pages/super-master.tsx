import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { GraduationCap, Plus, School, Loader2, Trash2, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { School as SchoolType } from "@shared/schema";

type EnrichedSchool = Pick<SchoolType, "id" | "name" | "code"> & { activeStudentCount: number };

const addSchoolSchema = z.object({
  name: z.string().min(2, "School name must be at least 2 characters"),
  code: z.string().min(2, "School code must be at least 2 characters").max(20, "School code must be at most 20 characters").regex(/^[A-Z0-9]+$/, "Code must be uppercase letters and numbers only"),
  principalEmail: z.string().email("Enter a valid email address"),
  principalPassword: z.string().min(6, "Password must be at least 6 characters"),
});

type AddSchoolForm = z.infer<typeof addSchoolSchema>;

export default function SuperMaster() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [deleteTarget, setDeleteTarget] = useState<Pick<SchoolType, "id" | "name" | "code"> | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [restoringPage, setRestoringPage] = useState(false);

  const auth = useQuery<{ id: number; email: string; csrfToken: string }>({
    queryKey: ["/api/super-admin/session"],
    queryFn: async () => {
      const response = await fetch("/api/super-admin/session", { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("Super Admin login required");
      return response.json();
    },
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
  useEffect(() => {
    if (auth.isError) setLocation("/super-master/login");
  }, [auth.isError, setLocation]);
  useEffect(() => {
    const root = document.documentElement;
    const onPageHide = () => { root.style.visibility = "hidden"; };
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setRestoringPage(true);
      void auth.refetch().finally(() => {
        root.style.visibility = "";
        setRestoringPage(false);
      });
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      root.style.visibility = "";
    };
  }, [auth.refetch]);

  const { data: schools = [], isLoading } = useQuery<EnrichedSchool[]>({
    queryKey: ["/api/schools"],
    enabled: !!auth.data && !auth.isFetching && !auth.isError,
    queryFn: async () => {
      const response = await fetch("/api/schools", { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load schools");
      return response.json();
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  const form = useForm<AddSchoolForm>({
    resolver: zodResolver(addSchoolSchema),
    defaultValues: {
      name: "",
      code: "",
      principalEmail: "",
      principalPassword: "",
    },
  });

  const createSchoolMutation = useMutation({
    mutationFn: async (data: AddSchoolForm) => {
      const res = await fetch("/api/schools", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Super-Admin-CSRF": auth.data?.csrfToken ?? "" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Unable to add school");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "School added", description: "The school and principal account have been created." });
      form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/schools"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteSchoolMutation = useMutation({
    mutationFn: async ({ id, password }: { id: number; password: string }) => {
      const res = await fetch(`/api/schools/${id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Super-Admin-CSRF": auth.data?.csrfToken ?? "" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Unable to delete school");
    },
    onSuccess: () => {
      toast({ title: "School deleted", description: "The school, principal account, and all student records have been removed." });
      setDeleteTarget(null);
      setDeletePassword("");
      queryClient.invalidateQueries({ queryKey: ["/api/schools"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setDeletePassword("");
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/super-admin/logout", {
        method: "POST",
        credentials: "include",
        headers: { "X-Super-Admin-CSRF": auth.data?.csrfToken ?? "" },
      });
      if (!response.ok) throw new Error("Unable to log out");
    },
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["/api/super-admin/session"], exact: true });
      queryClient.removeQueries({ queryKey: ["/api/schools"], exact: true });
      setLocation("/super-master/login");
    },
    onError: (error: Error) => {
      toast({ title: "Logout failed", description: `${error.message}. Your session remains active; retry logout before leaving.`, variant: "destructive" });
    },
  });

  function onSubmit(data: AddSchoolForm) {
    createSchoolMutation.mutate(data);
  }

  if (auth.isLoading || auth.isFetching || restoringPage) return <div className="min-h-screen grid place-items-center">Checking Super Admin session…</div>;
  if (!auth.data) return null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary">
            <GraduationCap className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight" data-testid="text-super-master-title">BENIUS</h1>
            <p className="text-xs text-muted-foreground">Super Admin Panel</p>
          </div>
          </div>
          <Button variant="outline" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}>Log out</Button>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8 space-y-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Plus className="w-5 h-5" />
              Add New School
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>School Name</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. Maple Leaf School"
                            data-testid="input-school-name"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>School Code</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. MLS"
                            data-testid="input-school-code"
                            {...field}
                            onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="principalEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Principal Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="e.g. principal@school.com"
                            data-testid="input-principal-email"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="principalPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Principal Password</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="Min. 6 characters"
                            data-testid="input-principal-password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={createSchoolMutation.isPending}
                  data-testid="button-add-school"
                >
                  {createSchoolMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : null}
                  Add School
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <School className="w-5 h-5" />
              Registered Schools
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : schools.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-no-schools">
                No schools registered yet. Use the form above to add your first school.
              </div>
            ) : (
              <div className="space-y-2">
                {schools.map((school) => (
                  <div
                    key={school.id}
                    className="flex items-center justify-between gap-4 px-4 py-3 rounded-md bg-muted/50"
                    data-testid={`row-school-${school.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary/10 flex-shrink-0">
                        <School className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm" data-testid={`text-school-name-${school.id}`}>{school.name}</p>
                        <p className="text-xs text-muted-foreground">ID: {school.id}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono bg-secondary px-2 py-1 rounded-md" data-testid={`text-school-code-${school.id}`}>
                        {school.code}
                      </span>
                      <span
                        className="flex items-center gap-1 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-md"
                        data-testid={`text-active-students-${school.id}`}
                      >
                        <Users className="w-3 h-3" />
                        {(school.activeStudentCount ?? 0).toLocaleString()} active students
                      </span>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleteTarget(school)}
                        data-testid={`button-delete-school-${school.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeletePassword(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete School</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong> ({deleteTarget?.code})?
              This will permanently remove the school, the principal's account, and all associated student records. This action cannot be undone.
            </AlertDialogDescription>
            <label className="block space-y-2 text-sm font-medium">
              Re-enter your Super Admin password
              <Input type="password" autoComplete="current-password" value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)} maxLength={1024}
                data-testid="input-super-admin-delete-password" />
            </label>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (deleteTarget && deletePassword) deleteSchoolMutation.mutate({ id: deleteTarget.id, password: deletePassword });
              }}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete"
              disabled={!deletePassword || deleteSchoolMutation.isPending}
            >
              {deleteSchoolMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
