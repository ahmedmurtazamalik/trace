"use client";

import { useSearchParams } from "next/navigation";
import { githubCallbackResultSchema, type GithubCallbackResult } from "@trace/shared";
import { GithubConnectionPanel } from "./github-connection-panel";

/** Reads only the frozen closed callback result; raw provider/state values are ignored. */
function callbackResult(searchParams: URLSearchParams): GithubCallbackResult | undefined {
  const result = searchParams.get("result");
  const reason = searchParams.get("reason");
  const parsed = githubCallbackResultSchema.safeParse(result === "error" ? { result, reason } : { result });
  return parsed.success ? parsed.data : undefined;
}

export function GithubRoute() {
  const searchParams = useSearchParams();
  return <GithubConnectionPanel callbackResult={callbackResult(searchParams)} />;
}
