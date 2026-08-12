"use client";

import { useState, type FormEvent } from "react";
import { Input, Label } from "@trace/ui";
import type { AuthSessionResponse } from "@trace/shared";
import { AuthApiError, login } from "@/api/auth";

interface LoginFormProps {
  onAuthenticated(session: AuthSessionResponse): void;
  authenticate?: typeof login;
}

interface FieldErrors {
  username?: string;
  password?: string;
}

export function LoginForm({ onAuthenticated, authenticate = login }: LoginFormProps) {
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const nextErrors: FieldErrors = {
      ...(!username ? { username: "Enter your username." } : {}),
      ...(!password ? { password: "Enter your password." } : {}),
    };
    setFieldErrors(nextErrors);
    setFormError(undefined);
    setSuccess(false);
    if (Object.keys(nextErrors).length > 0) return;

    setPending(true);
    try {
      const session = await authenticate({ username, password });
      setSuccess(true);
      onAuthenticated(session);
    } catch (error) {
      setFormError(error instanceof AuthApiError ? error.message : "Trace could not complete the request. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      {formError && <div className="auth-alert auth-alert-error" role="alert">{formError}</div>}
      {success && <div className="auth-alert auth-alert-success" role="status">Signed in securely.</div>}
      <div className="auth-field">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          name="username"
          autoComplete="username"
          aria-invalid={Boolean(fieldErrors.username)}
          aria-describedby={fieldErrors.username ? "username-error" : undefined}
          disabled={pending}
        />
        {fieldErrors.username && <p className="field-error" id="username-error">{fieldErrors.username}</p>}
      </div>
      <div className="auth-field">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={fieldErrors.password ? "password-error" : undefined}
          disabled={pending}
        />
        {fieldErrors.password && <p className="field-error" id="password-error">{fieldErrors.password}</p>}
      </div>
      <button type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
