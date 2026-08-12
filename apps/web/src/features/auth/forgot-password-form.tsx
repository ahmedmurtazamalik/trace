"use client";

import { useState, type FormEvent } from "react";
import { Input, Label } from "@trace/ui";
import { forgotPassword } from "@/api/auth";
import { useAuthSubmission } from "./use-auth-submission";

export function ForgotPasswordForm({ requestReset = forgotPassword }: { requestReset?: typeof forgotPassword }) {
  const [fieldError, setFieldError] = useState<string>();
  const submission = useAuthSubmission();
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const identifier = String(new FormData(event.currentTarget).get("identifier") ?? "").trim();
    if (identifier.length < 3) { setFieldError("Enter at least 3 characters."); return; }
    setFieldError(undefined);
    await submission.submit(async () => {
      const result = await requestReset({ identifier });
      submission.setSuccess(result.message);
    });
  }
  return <form className="auth-form" onSubmit={handleSubmit} noValidate>
    {submission.error && <div className="auth-alert auth-alert-error" role="alert">{submission.error}</div>}
    {submission.success && <div className="auth-alert auth-alert-success" role="status">{submission.success}</div>}
    <div className="auth-field"><Label htmlFor="identifier">Username or email</Label><Input id="identifier" name="identifier" autoComplete="username" disabled={submission.pending} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? "identifier-error" : undefined} />{fieldError && <p className="field-error" id="identifier-error">{fieldError}</p>}</div>
    <button type="submit" disabled={submission.pending}>{submission.pending ? "Requesting…" : "Request reset"}</button>
  </form>;
}
