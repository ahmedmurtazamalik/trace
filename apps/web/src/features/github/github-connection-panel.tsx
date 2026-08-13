"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Github, History, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge, Button, Card } from "@trace/ui";
import type { GithubCallbackResult, GithubConnectionStatus } from "@trace/shared";
import { connectGithub, disconnectGithub, getGithubInstallation, getGithubStatus, GithubApiError } from "@/api/github";
import { useAuthSession } from "@/auth/session-provider";

type LoadStatus = typeof getGithubStatus;
type BeginConnection = typeof connectGithub;
type BeginInstallation = typeof getGithubInstallation;
type RevokeConnection = typeof disconnectGithub;

interface GithubConnectionPanelProps {
  loadStatus?: LoadStatus;
  beginConnection?: BeginConnection;
  beginInstallation?: BeginInstallation;
  revokeConnection?: RevokeConnection;
  navigate?: (url: string) => void;
  callbackResult?: GithubCallbackResult;
}

const callbackMessages: Record<string, string> = {
  connected: "GitHub connected. Trace is refreshing your connection status.",
  reconnect_required: "GitHub needs to be reconnected before Trace can continue.",
  state_invalid: "This GitHub connection request is no longer valid. Please start again.",
  callback_failed: "GitHub could not complete the connection. Please try again.",
  access_denied: "GitHub access was not granted. Your Trace account is unchanged.",
  session_expired: "Your Trace session expired during the GitHub connection. Please sign in and try again.",
};

function errorMessage(error: unknown) {
  return error instanceof GithubApiError ? error.message : "Trace could not complete the GitHub request. Please try again.";
}

export function GithubConnectionPanel({
  loadStatus = getGithubStatus,
  beginConnection = connectGithub,
  beginInstallation = getGithubInstallation,
  revokeConnection = disconnectGithub,
  navigate = (url) => window.location.assign(url),
  callbackResult,
}: GithubConnectionPanelProps) {
  const { csrfToken } = useAuthSession();
  const [status, setStatus] = useState<GithubConnectionStatus>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"connect" | "install" | "disconnect">();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadStatus({ signal: controller.signal })
      .then(setStatus)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(errorMessage(reason));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [loadStatus]);

  useEffect(() => {
    const restoreNavigation = () => setPending((current) => current === "connect" || current === "install" ? undefined : current);
    window.addEventListener("pageshow", restoreNavigation);
    return () => window.removeEventListener("pageshow", restoreNavigation);
  }, []);

  async function begin() {
    setPending("connect");
    setError(undefined);
    try {
      const result = await beginConnection();
      navigate(result.authorizationUrl);
    } catch (reason) {
      setError(errorMessage(reason));
      setPending(undefined);
    }
  }

  async function install() {
    setPending("install");
    setError(undefined);
    try {
      const result = await beginInstallation();
      navigate(result.installationUrl);
    } catch (reason) {
      setError(errorMessage(reason));
      setPending(undefined);
    }
  }

  async function disconnect() {
    if (!csrfToken) {
      setError("Your security session is no longer valid. Please sign in again.");
      return;
    }
    setPending("disconnect");
    setError(undefined);
    try {
      const result = await revokeConnection(csrfToken);
      let historyRetained = result.historyRetained;
      try {
        const authoritativeStatus = await loadStatus();
        setStatus(authoritativeStatus);
        historyRetained = historyRetained && authoritativeStatus.historyRetained;
      } catch {
        const account = status?.accountConnection.account;
        setStatus({
          accountConnection: account
            ? { status: "RECONNECT_REQUIRED", account }
            : { status: "DISCONNECTED", account: null },
          installationAuthorization: { status: "NOT_INSTALLED", installation: null },
          accessibleRepositoryCount: 0,
          trackedRepositoryCount: 0,
          historyRetained: result.historyRetained,
        });
      }
      setConfirmDisconnect(false);
      setNotice("GitHub disconnected. Historical activity remains in Trace.");
      if (!historyRetained) {
        setError("Trace could not confirm retained GitHub history. Please refresh and try again.");
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(undefined);
    }
  }

  const callbackMessage = callbackResult
    ? callbackMessages[callbackResult.result === "error" ? callbackResult.reason : callbackResult.result]
    : undefined;
  const callbackIsError = callbackResult?.result === "error";

  if (loading) return <Card className="github-loading" role="status"><RefreshCw aria-hidden="true" size={20} /><span>Checking GitHub connection…</span></Card>;
  if (!status) return <Card className="github-error-card"><AlertTriangle aria-hidden="true" /><div><h2>GitHub status unavailable</h2><p role="alert">{error}</p><Button onClick={() => window.location.reload()}>Try again</Button></div></Card>;

  const account = status.accountConnection.account;
  const installation = status.installationAuthorization.installation;
  const reconnectRequired = status.accountConnection.status === "RECONNECT_REQUIRED";
  const disconnected = status.accountConnection.status === "DISCONNECTED";

  return <div className="github-stack">
    {callbackMessage && <div className={`github-notice ${callbackIsError ? "github-notice-error" : "github-notice-success"}`} role={callbackIsError ? "alert" : "status"}>
      {callbackIsError ? <AlertTriangle aria-hidden="true" size={18} /> : <CheckCircle2 aria-hidden="true" size={18} />}
      <span>{callbackMessage}</span>
    </div>}
    {error && <div className="github-notice github-notice-error" role="alert"><AlertTriangle aria-hidden="true" size={18} /><span>{error}</span></div>}
    {notice && <div className="github-notice github-notice-success" role="status"><CheckCircle2 aria-hidden="true" size={18} /><span>{notice}</span></div>}

    <Card className={`github-hero-card ${reconnectRequired ? "github-hero-warning" : ""}`}>
      <div className="github-hero-icon"><Github aria-hidden="true" size={30} /></div>
      <div className="github-hero-copy">
        <div className="github-heading-row"><span className="eyebrow">ACCOUNT CONNECTION</span><Badge>{disconnected ? "Not connected" : reconnectRequired ? "Reconnect required" : "Connected"}</Badge></div>
        <h2>{disconnected ? "Connect GitHub" : reconnectRequired ? "Reconnect GitHub" : account?.displayName ?? account?.username}</h2>
        <p>{disconnected
          ? "Attach GitHub to your existing Trace account. GitHub never replaces your Trace username and password."
          : reconnectRequired
            ? "Restore GitHub authorization to refresh repository access while keeping existing Trace history."
            : <>Linked as <strong>@{account?.username}</strong>. Trace sign-in remains separate.</>}</p>
        <div className="github-actions">
          {(disconnected || reconnectRequired) && <Button onClick={begin} disabled={Boolean(pending)}>{pending === "connect" ? "Opening GitHub…" : reconnectRequired ? "Reconnect GitHub" : "Connect GitHub"}</Button>}
          {!disconnected && !reconnectRequired && <Button className="trace-button-secondary" onClick={() => setConfirmDisconnect(true)} disabled={Boolean(pending)}>Disconnect GitHub</Button>}
        </div>
      </div>
    </Card>

    <div className="github-status-grid">
      <Card className="github-status-card">
        <div className="github-card-icon"><ShieldCheck aria-hidden="true" size={20} /></div>
        <span className="eyebrow">APP INSTALLATION</span>
        <h3>{status.installationAuthorization.status === "ACTIVE" ? "Installation active" : status.installationAuthorization.status === "SUSPENDED" ? "Installation suspended" : "Not installed"}</h3>
        <p>{installation ? <><strong>{installation.accountLogin}</strong> · {installation.accountType === "ORGANIZATION" ? "Organization" : "Personal"}</> : "Install the Trace GitHub App after connecting to choose repository access."}</p>
        {status.accountConnection.status === "CONNECTED" && status.installationAuthorization.status !== "ACTIVE" && <div className="github-actions">
          <Button onClick={install} disabled={Boolean(pending)}>
            {pending === "install" ? "Opening GitHub…" : status.installationAuthorization.status === "SUSPENDED" ? "Update GitHub App installation" : "Install GitHub App"}
          </Button>
        </div>}
      </Card>
      <Card className="github-status-card">
        <div className="github-card-icon"><LockKeyhole aria-hidden="true" size={20} /></div>
        <span className="eyebrow">REPOSITORY ACCESS</span>
        <h3>{status.accessibleRepositoryCount} accessible</h3>
        <p><strong>{status.trackedRepositoryCount} tracked</strong> by Trace. Access and tracking remain separate controls.</p>
      </Card>
      <Card className="github-status-card">
        <div className="github-card-icon"><History aria-hidden="true" size={20} /></div>
        <span className="eyebrow">HISTORY</span>
        <h3>Activity retained</h3>
        <p>Disconnecting GitHub stops future access but does not delete historical activity already stored in Trace.</p>
      </Card>
    </div>

    <Card className="github-repository-preview">
      <div><span className="eyebrow">DAY 4 PREVIEW</span><h2>Repository management comes next</h2><p>This visual preview is illustrative. Real repository access and tracking controls begin after the Day 3 repository contract is frozen.</p></div>
      <div className="github-preview-rows" aria-label="Illustrative repository list">
        <div><span><strong>trace/web</strong><small>Public · main</small></span><Badge>Illustrative</Badge></div>
        <div><span><strong>trace/api</strong><small>Private · main</small></span><Badge>Illustrative</Badge></div>
      </div>
    </Card>

    {confirmDisconnect && <div className="trace-dialog-backdrop">
      <section role="dialog" aria-modal="true" aria-labelledby="github-disconnect-title" className="trace-dialog github-dialog">
        <h2 id="github-disconnect-title">Disconnect GitHub?</h2>
        <p>Trace will stop requesting GitHub access. Historical activity remains in Trace and is not deleted.</p>
        <div className="github-dialog-actions">
          <Button className="trace-button-secondary" onClick={() => setConfirmDisconnect(false)} disabled={Boolean(pending)}>Cancel</Button>
          <Button className="trace-button-danger" onClick={disconnect} disabled={Boolean(pending)}>{pending === "disconnect" ? "Disconnecting…" : "Confirm disconnect"}</Button>
        </div>
      </section>
    </div>}
  </div>;
}
