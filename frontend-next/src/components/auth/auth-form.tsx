"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Mode = "login" | "signup";
type Errors = Partial<Record<"name" | "email" | "password" | "form", string>>;

const COPY = {
  login: { title: "Sign in to Coedit", sub: "Pick up where your team left off.", cta: "Sign in", alt: "New to Coedit?", altLink: "/signup", altText: "Create a workspace" },
  signup: { title: "Create your workspace", sub: "Free for up to three people. No card needed.", cta: "Create workspace", alt: "Already have an account?", altLink: "/login", altText: "Sign in" },
} as const;

export function AuthForm({ mode }: { mode: Mode }) {
  const c = COPY[mode];
  const router = useRouter();
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

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

    setBusy(true);
    await new Promise((r) => setTimeout(r, 800)); // mock request
    setBusy(false);
    toast.success(mode === "login" ? "Signed in" : "Workspace created");
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
      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-4">
        {mode === "signup" && field("name", "Name", { autoComplete: "name", placeholder: "Priya Nair" })}
        {field("email", "Work email", { type: "email", autoComplete: "email", placeholder: "priya@northwind.example" })}
        {field("password", "Password", { type: "password", autoComplete: mode === "login" ? "current-password" : "new-password" })}
        {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
        <Button type="submit" disabled={busy} className="h-10 w-full bg-tidal text-on-fill hover:opacity-90">
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {busy ? "Working…" : c.cta}
        </Button>
      </form>
      <p className="mt-6 text-sm text-ink-2">{c.alt} <Link href={c.altLink} className="font-medium text-azure underline-offset-4 hover:underline">{c.altText}</Link></p>
      <p className="mt-8 text-xs text-ink-3">This is a preview build. Nothing is sent anywhere; any valid-looking details will let you in.</p>
    </div>
  );
}
