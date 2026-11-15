"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useMounted } from "@/hooks/use-mounted";
import { ApiError } from "@/api/client";
import { useLogin, useRegister } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Mode = "login" | "signup";
type Errors = Partial<Record<"name" | "email" | "password" | "form", string>>;

const COPY = {
  login: { title: "Sign in to Coedit", sub: "Pick up where your team left off.", cta: "Sign in", alt: "New to Coedit?", altLink: "/signup", altText: "Create an account" },
  signup: { title: "Create your account", sub: "Free for up to three people. No card needed.", cta: "Create account", alt: "Already have an account?", altLink: "/login", altText: "Sign in" },
} as const;

export function AuthForm({ mode }: { mode: Mode }) {
  const c = COPY[mode];
  const router = useRouter();
  const [errors, setErrors] = useState<Errors>({});
  const login = useLogin();
  const register = useRegister();
  const busy = login.isPending || register.isPending;
  // Until hydration finishes the form has no handler; a native submit would put the credentials in the URL.
  const ready = useMounted();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    const email = String(f.get("email") ?? "").trim();
    const password = String(f.get("password") ?? "");
    const next: Errors = {};
    if (mode === "signup" && !name) next.name = "Enter your name.";
    if (!/^\S+@\S+\.\S+$/.test(email)) next.email = "Enter an email like name@company.com.";
    if (password.length < 8) next.password = "Use at least 8 characters.";
    setErrors(next);
    if (Object.keys(next).length) return;

    try {
      if (mode === "login") await login.mutateAsync({ email, password });
      else await register.mutateAsync({ email, password, display_name: name });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Coedit couldn't reach the server. Try again in a moment.";
      setErrors({ form: message });
      return;
    }
    toast.success(mode === "login" ? "Signed in" : "Account created");
    router.push("/app");
  }

  const field = (id: keyof Errors, label: string, props: React.ComponentProps<typeof Input>) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} aria-invalid={!!errors[id]} aria-describedby={errors[id] ? `${id}-err` : undefined} className="h-10" {...props} />
      {errors[id] && <p id={`${id}-err`} className="text-xs text-danger">{errors[id]}</p>}
    </div>
  );

  return (
    <div className="w-full max-w-sm">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">{c.title}</h1>
      <p className="mt-2 text-sm text-ink-2">{c.sub}</p>
      <form method="post" onSubmit={onSubmit} noValidate className="mt-8 space-y-4">
        {mode === "signup" && field("name", "Name", { autoComplete: "name", placeholder: "Your name" })}
        {field("email", "Work email", { type: "email", autoComplete: "email", placeholder: "name@company.com" })}
        {field("password", "Password", { type: "password", autoComplete: mode === "login" ? "current-password" : "new-password" })}
        {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
        <Button type="submit" disabled={busy || !ready} className="h-10 w-full bg-tidal text-on-fill hover:opacity-90">
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {busy ? "Working…" : c.cta}
        </Button>
      </form>
      <p className="mt-6 text-sm text-ink-2">{c.alt} <Link href={c.altLink} className="font-medium text-azure underline-offset-4 hover:underline">{c.altText}</Link></p>
      
    </div>
  );
}
