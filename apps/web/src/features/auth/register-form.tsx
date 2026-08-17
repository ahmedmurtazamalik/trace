"use client";

import { useState, type FormEvent } from "react";
import { Input, Label } from "@trace/ui";
import type { AuthSessionResponse } from "@trace/shared";
import { register } from "@/api/auth";
import { useAuthSubmission } from "./use-auth-submission";

interface Props {
  createAccount?: typeof register;
  onAuthenticated(session: AuthSessionResponse): void;
}

type Errors = Partial<Record<"username" | "email" | "password", string>>;
const usernamePattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

export function RegisterForm({ createAccount = register, onAuthenticated }: Props) {
  const [errors, setErrors] = useState<Errors>({});
  const submission = useAuthSubmission();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const username = String(data.get("username") ?? "").trim();
    const displayName = String(data.get("displayName") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const next: Errors = {};
    if (username.length < 3 || username.length > 39 || !usernamePattern.test(username)) next.username = "Use 3–39 letters, numbers, dots, underscores, or hyphens.";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = "Enter a valid email address.";
    if (password.length < 12) next.password = "Use at least 12 characters.";
    setErrors(next);
    if (Object.keys(next).length) {
      const firstInvalid = next.username ? "username" : next.email ? "email" : "password";
      const field = event.currentTarget.elements.namedItem(firstInvalid);
      if (field instanceof HTMLElement) field.focus();
      return;
    }
    await submission.submit(async () => {
      const session = await createAccount({
        username,
        ...(displayName ? { displayName } : {}),
        ...(email ? { email } : {}),
        password,
      });
      submission.setSuccess("Account created securely.");
      onAuthenticated(session);
    });
  }

  return <form className="auth-form" onSubmit={handleSubmit} noValidate>
    {submission.error && <div className="auth-alert auth-alert-error" role="alert">{submission.error}</div>}
    {submission.success && <div className="auth-alert auth-alert-success" role="status">{submission.success}</div>}
    <AuthField id="register-username" name="username" label="Username" autoComplete="username" error={errors.username} disabled={submission.pending} />
    <AuthField id="display-name" name="displayName" label="Display name (optional)" autoComplete="name" disabled={submission.pending} />
    <AuthField id="register-email" name="email" label="Email (optional)" type="email" autoComplete="email" error={errors.email} disabled={submission.pending} />
    <AuthField id="register-password" name="password" label="Password" type="password" autoComplete="new-password" error={errors.password} disabled={submission.pending} />
    <button type="submit" disabled={submission.pending}>{submission.pending ? "Creating account…" : "Create account"}</button>
  </form>;
}

interface AuthFieldProps extends React.InputHTMLAttributes<HTMLInputElement> { id: string; label: string; error?: string }
function AuthField({ id, label, error, ...props }: AuthFieldProps) {
  return <div className="auth-field"><Label htmlFor={id}>{label}</Label><Input id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...props} />{error && <p className="field-error" id={`${id}-error`}>{error}</p>}</div>;
}
