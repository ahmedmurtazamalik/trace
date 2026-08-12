"use client";

import { useState } from "react";
import { AuthApiError } from "@/api/auth";

/** Shared pending/result state for auth forms; domain validation remains local. */
export function useAuthSubmission() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();

  async function submit(action: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof AuthApiError ? reason.message : "Trace could not complete the request. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return { pending, error, success, setSuccess, submit };
}
