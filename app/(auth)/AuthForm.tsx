"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthState } from "./actions";

export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: "login" | "signup";
  action: (state: AuthState, form: FormData) => Promise<AuthState>;
  next?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const isLogin = mode === "login";
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">{isLogin ? "Welcome back" : "Create your account"}</h1>
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            minLength={isLogin ? 1 : 8}
            required
          />
        </div>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        <button className="btn-primary w-full" disabled={pending}>
          {pending ? "…" : isLogin ? "Log in" : "Continue"}
        </button>
      </form>
      <p className="text-sm text-muted">
        {isLogin ? "New here? " : "Already have an agent? "}
        <Link className="text-accent underline" href={`${isLogin ? "/signup" : "/login"}${next ? `?next=${encodeURIComponent(next)}` : ""}`}>
          {isLogin ? "Create your agent" : "Log in"}
        </Link>
      </p>
    </main>
  );
}
