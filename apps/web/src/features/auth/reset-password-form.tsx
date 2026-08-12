"use client";

import { useState, type FormEvent } from "react";
import { Input, Label } from "@trace/ui";
import { resetPassword } from "@/api/auth";
import { useAuthSubmission } from "./use-auth-submission";

interface Props { token: string | null; resetCredential?: typeof resetPassword }
export function ResetPasswordForm({ token, resetCredential = resetPassword }: Props) {
  const [fieldError, setFieldError] = useState<string>();
  const submission = useAuthSubmission();
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    if (password.length < 12) { setFieldError("Use at least 12 characters."); return; }
    setFieldError(undefined);
    await submission.submit(async () => {
      await resetCredential({ token, password });
      submission.setSuccess("Password updated. You can now sign in.");
    });
  }
  return <form className="auth-form" onSubmit={handleSubmit} noValidate>
    {!token && <div className="auth-alert auth-alert-error" role="alert">This reset link is invalid or has expired.</div>}
    {submission.error && <div className="auth-alert auth-alert-error" role="alert">{submission.error}</div>}
    {submission.success && <div className="auth-alert auth-alert-success" role="status">{submission.success}</div>}
    <div className="auth-field"><Label htmlFor="new-password">New password</Label><Input id="new-password" name="password" type="password" autoComplete="new-password" disabled={submission.pending || !token} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? "new-password-error" : undefined} />{fieldError && <p className="field-error" id="new-password-error">{fieldError}</p>}</div>
    <button type="submit" disabled={submission.pending || !token}>{submission.pending ? "Updating…" : "Update password"}</button>
  </form>;
}
