import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useLogin, useMe, useRegister } from "../api/auth";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const me = useMe();
  const login = useLogin();
  const register = useRegister();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const isRegister = mode === "register";
  const mutation = isRegister ? register : login;
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  if (me.data) return <Navigate to={from} replace />;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (isRegister) register.mutate({ email, password, display_name: displayName });
    else login.mutate({ email, password });
  }

  return (
    <main className="auth">
      <form className="card" onSubmit={onSubmit}>
        <h1>coedit</h1>
        <h2>{isRegister ? "Create your account" : "Sign in"}</h2>
        {isRegister && (
          <label>
            Name
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
              maxLength={80}
              required
              autoFocus
            />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            autoFocus={!isRegister}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isRegister ? "new-password" : "current-password"}
            minLength={isRegister ? 8 : 1}
            required
          />
          {isRegister && <small>At least 8 characters.</small>}
        </label>
        {mutation.isError && (
          <p className="error" role="alert">
            {mutation.error.message}
          </p>
        )}
        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "…" : isRegister ? "Create account" : "Sign in"}
        </button>
        <p className="switch">
          {isRegister ? (
            <>
              Already have an account? <Link to="/login" state={location.state}>Sign in</Link>
            </>
          ) : (
            <>
              New here? <Link to="/register" state={location.state}>Create an account</Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
