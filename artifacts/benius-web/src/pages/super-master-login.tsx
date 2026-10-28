import { useState } from "react";
import { useLocation } from "wouter";
import { GraduationCap, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SuperMasterLogin() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/super-admin/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Login failed");
      setPassword("");
      setLocation("/super-master");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Login failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center bg-background p-4">
      <section className="w-full max-w-md rounded-xl border bg-card p-7 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold">Super Admin Login</h1>
          <p className="text-sm text-muted-foreground">Sign in to manage BENIUS schools.</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <label className="block space-y-2 text-sm font-medium">Email
            <Input type="email" autoComplete="username" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} />
          </label>
          <label className="block space-y-2 text-sm font-medium">Password
            <Input type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} />
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" type="submit" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Log in
          </Button>
        </form>
      </section>
    </main>
  );
}
