'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Badge, Button, Card } from '@trace/ui';
import type {
  RepositoryListResponse,
  WorkspaceInvitation,
  WorkspaceInvitationCreateRequest,
  WorkspaceInvitationCreateResponse,
  WorkspaceInvitationDecisionResponse,
  WorkspaceInvitationListResponse,
  WorkspaceAssignRepositoryRequest,
  WorkspaceCreateRequest,
  WorkspaceCreateResponse,
  WorkspaceDetailResponse,
  WorkspaceListResponse,
  WorkspaceMemberRemovalResponse,
  WorkspaceMemberRoleUpdateRequest,
  WorkspaceMembershipResponse,
  WorkspaceRepositoryAssignmentResponse,
  WorkspaceRepositoryRemovalResponse,
  WorkspaceSummary,
  WorkspaceUpdateRequest,
  WorkspaceUpdateResponse,
  WorkspaceArchiveResponse,
  WorkspaceAnalysisResponse,
  WorkspaceAnalysisStartResponse,
  WorkspaceReportGenerateRequest,
  WorkspaceReportGenerateResponse,
  WorkspaceReportOccurrence,
  WorkspaceReportOccurrenceListResponse,
  WorkspaceReportSchedule,
  WorkspaceReportScheduleRequest,
  WorkspaceReportScheduleResponse,
  ReportListResponse,
  ReportSummary,
} from '@trace/shared';
import { Building2, FolderGit2, RefreshCw, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { WorkspaceApiError } from '@/api/workspaces';
import { formatPakistanDateTime, PAKISTAN_TIMEZONE } from '@/lib/pakistan-time';

interface WorkspaceExperienceProps {
  csrfToken: string;
  loadWorkspaces(options?: { signal?: AbortSignal }): Promise<WorkspaceListResponse>;
  loadWorkspace(id: string, options?: { signal?: AbortSignal }): Promise<WorkspaceDetailResponse>;
  createWorkspace(input: WorkspaceCreateRequest, csrfToken: string, options?: { signal?: AbortSignal }): Promise<WorkspaceCreateResponse>;
  createInvitation(id: string, input: WorkspaceInvitationCreateRequest, csrfToken: string, options?: { signal?: AbortSignal }): Promise<WorkspaceInvitationCreateResponse>;
  loadInvitations(id: string, options?: { signal?: AbortSignal }): Promise<WorkspaceInvitationListResponse>;
  revokeInvitation(id: string, invitationId: string, csrfToken: string, options?: { signal?: AbortSignal }): Promise<WorkspaceInvitationDecisionResponse>;
  assignRepository(id: string, input: WorkspaceAssignRepositoryRequest, csrfToken: string, options?: { signal?: AbortSignal }): Promise<WorkspaceRepositoryAssignmentResponse>;
  updateWorkspace(id: string, input: WorkspaceUpdateRequest, csrfToken: string, options?: { signal?: AbortSignal }): Promise<WorkspaceUpdateResponse>;
  archiveWorkspace(id: string, csrfToken: string, options?: { signal?: AbortSignal }): Promise<WorkspaceArchiveResponse>;
  updateMemberRole(id: string, userId: string, input: WorkspaceMemberRoleUpdateRequest, csrfToken: string, options?: { signal?: AbortSignal }): Promise<WorkspaceMembershipResponse>;
  removeMember(id: string, userId: string, csrfToken: string, options?: { signal?: AbortSignal }): Promise<WorkspaceMemberRemovalResponse>;
  removeRepository(id: string, repositoryId: string, csrfToken: string, options?: { signal?: AbortSignal }): Promise<WorkspaceRepositoryRemovalResponse>;
  loadRepositories(query: { visibility: 'active' }, options?: { signal?: AbortSignal }): Promise<RepositoryListResponse>;
  loadAnalysis(id: string, options?: { signal?: AbortSignal }): Promise<WorkspaceAnalysisResponse>;
  startBaseline(id: string, repositoryId: string, csrfToken: string, options?: { signal?: AbortSignal }): Promise<WorkspaceAnalysisStartResponse>;
  generateReport(id: string, input: WorkspaceReportGenerateRequest, idempotencyKey: string, csrfToken: string, options?: { signal?: AbortSignal }): Promise<WorkspaceReportGenerateResponse>;
  loadSchedule(id: string, options?: { signal?: AbortSignal }): Promise<WorkspaceReportScheduleResponse>;
  saveSchedule(id: string, input: WorkspaceReportScheduleRequest, csrfToken: string, options?: { signal?: AbortSignal }): Promise<WorkspaceReportScheduleResponse>;
  disableSchedule(id: string, csrfToken: string, options?: { signal?: AbortSignal }): Promise<WorkspaceReportScheduleResponse>;
  loadOccurrences(id: string, options?: { signal?: AbortSignal }): Promise<WorkspaceReportOccurrenceListResponse>;
  loadReports(id: string, query: { limit: number; status: 'completed' }, options?: { signal?: AbortSignal }): Promise<ReportListResponse>;
  pollIntervalMs?: number;
}

function messageFor(reason: unknown) {
  return reason instanceof WorkspaceApiError ? reason.message : 'Trace could not complete the workspace request. Please try again.';
}

function isMembershipBoundaryFailure(reason: unknown): reason is WorkspaceApiError {
  return reason instanceof WorkspaceApiError
    && (reason.code === 'UNAUTHENTICATED' || reason.code === 'WORKSPACE_NOT_FOUND' || reason.code === 'WORKSPACE_MANAGER_REQUIRED');
}

function roleLabel(role: WorkspaceSummary['role']) {
  return role === 'MANAGER' ? 'Manager access' : 'Developer access';
}

const weekdays = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [7, 'Sunday']] as const;
const activeAnalysisStatuses = new Set(['PENDING', 'PROCESSING']);
const activeOccurrenceStatuses = new Set(['PENDING', 'QUEUED', 'PROCESSING']);

function titleCase(value: string) {
  return value.toLowerCase().replace(/(^|_)([a-z])/g, (_match, prefix: string, letter: string) => `${prefix ? ' ' : ''}${letter.toUpperCase()}`);
}

function scheduleSummary(schedule: WorkspaceReportSchedule | null) {
  if (!schedule) return 'No report schedule configured.';
  if (!schedule.enabled) return `Schedule disabled · ${titleCase(schedule.frequency)} at ${schedule.localTime} ${schedule.timezone}`;
  const frequency = schedule.frequency === 'SELECTED_DAYS'
    ? schedule.selectedDays.map((day) => weekdays.find(([number]) => number === day)?.[1]).filter(Boolean).join(', ')
    : titleCase(schedule.frequency);
  return `${frequency} at ${schedule.localTime} ${schedule.timezone}${schedule.nextRunLocal ? ` · Next ${schedule.nextRunLocal}` : ''}`;
}

function localInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function validTimezone(value: string) {
  if (value === 'UTC') return true;
  try { return value.includes('/') && new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone.length > 0; }
  catch { return false; }
}

function safeGitHubUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && (parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com') ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

export function WorkspaceExperience({
  csrfToken,
  loadWorkspaces,
  loadWorkspace,
  createWorkspace,
  createInvitation,
  loadInvitations,
  revokeInvitation,
  assignRepository,
  updateWorkspace,
  archiveWorkspace,
  updateMemberRole,
  removeMember,
  removeRepository,
  loadRepositories,
  loadAnalysis,
  startBaseline,
  generateReport,
  loadSchedule,
  saveSchedule,
  disableSchedule,
  loadOccurrences,
  loadReports,
  pollIntervalMs = 3_000,
}: WorkspaceExperienceProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<WorkspaceDetailResponse>();
  const [availableRepositories, setAvailableRepositories] = useState<RepositoryListResponse['items']>([]);
  const [workspaceName, setWorkspaceName] = useState('');
  const [renameName, setRenameName] = useState('');
  const [username, setUsername] = useState('');
  const [memberRole, setMemberRole] = useState<'MANAGER' | 'DEVELOPER'>('DEVELOPER');
  const [repositoryId, setRepositoryId] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [analyses, setAnalyses] = useState<WorkspaceAnalysisResponse['items']>([]);
  const [schedule, setSchedule] = useState<WorkspaceReportSchedule | null>(null);
  const [occurrences, setOccurrences] = useState<WorkspaceReportOccurrence[]>([]);
  const [completedReports, setCompletedReports] = useState<ReportSummary[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [copyableInvitationPaths, setCopyableInvitationPaths] = useState<Record<string, string>>({});
  const [reportWindowStart, setReportWindowStart] = useState(() => localInput(new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000)));
  const [reportWindowEnd, setReportWindowEnd] = useState(() => localInput(new Date()));
  const [frequency, setFrequency] = useState<WorkspaceReportScheduleRequest['frequency']>('WEEKDAYS');
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [localTime, setLocalTime] = useState('09:00');
  const [timezone, setTimezone] = useState(PAKISTAN_TIMEZONE);
  const requestGeneration = useRef(0);
  const idempotencySequence = useRef(0);
  const detailController = useRef<AbortController>();
  const mutationController = useRef<AbortController>();

  useEffect(() => {
    const controller = new AbortController();
    loadWorkspaces({ signal: controller.signal })
      .then((response) => setWorkspaces(response.items))
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(messageFor(reason));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [loadWorkspaces]);

  const openWorkspace = useCallback(async (id: string) => {
    const generation = ++requestGeneration.current;
    detailController.current?.abort();
    mutationController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    setSelectedId(id);
    setDetailLoading(true);
    setSubmitting(false);
    setError(undefined);
    setStatus(undefined);
    setDetail(undefined);
    setAnalyses([]);
    setSchedule(null);
    setOccurrences([]);
    setCompletedReports([]);
    setInvitations([]);
    setAvailableRepositories([]);
    try {
      const response = await loadWorkspace(id, { signal: controller.signal });
      if (generation !== requestGeneration.current) return;
      const canManage = response.workspace.role === 'MANAGER' && response.workspace.archivedAt === null;
      const [analysisResponse, scheduleResponse, occurrenceResponse, repositories, reportResponse, invitationResponse] = canManage
        ? await Promise.all([
          loadAnalysis(id, { signal: controller.signal }),
          loadSchedule(id, { signal: controller.signal }),
          loadOccurrences(id, { signal: controller.signal }),
          loadRepositories({ visibility: 'active' }, { signal: controller.signal }),
          Promise.resolve({ items: [], pageInfo: { nextCursor: null, hasNextPage: false } } as ReportListResponse),
          loadInvitations(id, { signal: controller.signal }),
        ])
        : await Promise.all([
          Promise.resolve({ items: [] } as WorkspaceAnalysisResponse),
          Promise.resolve({ schedule: null } as WorkspaceReportScheduleResponse),
          Promise.resolve({ items: [] } as WorkspaceReportOccurrenceListResponse),
          Promise.resolve({ items: [], pageInfo: { nextCursor: null, hasNextPage: false } } as RepositoryListResponse),
          loadReports(id, { limit: 100, status: 'completed' }, { signal: controller.signal }),
          Promise.resolve({ items: [] } as WorkspaceInvitationListResponse),
        ]);
      if (generation !== requestGeneration.current) return;
      setDetail(response);
      setRenameName(response.workspace.name);
      setAnalyses(analysisResponse.items);
      setSchedule(scheduleResponse.schedule);
      setOccurrences(occurrenceResponse.items);
      setCompletedReports(reportResponse.items.filter((item) => item.status === 'completed'));
      setInvitations(invitationResponse.items);
      setAvailableRepositories(repositories.items.filter((item) => item.accessible && !item.removed));
      const rule = scheduleResponse.schedule;
      if (rule) {
        setFrequency(rule.frequency);
        setSelectedDays(rule.selectedDays);
        setLocalTime(rule.localTime);
        setTimezone(rule.timezone);
      }
    } catch (reason) {
      if (generation !== requestGeneration.current || (reason instanceof DOMException && reason.name === 'AbortError')) return;
      setDetail(undefined);
      setAnalyses([]);
      setSchedule(null);
      setOccurrences([]);
      setCompletedReports([]);
      setAvailableRepositories([]);
      setError(messageFor(reason));
    } finally {
      if (generation === requestGeneration.current) setDetailLoading(false);
    }
  }, [loadAnalysis, loadInvitations, loadOccurrences, loadRepositories, loadReports, loadSchedule, loadWorkspace]);

  useEffect(() => () => {
    requestGeneration.current += 1;
    detailController.current?.abort();
    mutationController.current?.abort();
  }, []);

  useEffect(() => {
    if (!detail || detail.workspace.id !== selectedId) return;
    const shouldPoll = analyses.some((item) => activeAnalysisStatuses.has(item.status))
      || occurrences.some((item) => activeOccurrenceStatuses.has(item.status));
    if (!shouldPoll) return;
    const generation = requestGeneration.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      Promise.all([
        loadAnalysis(detail.workspace.id, { signal: controller.signal }),
        detail.workspace.role === 'MANAGER'
          ? loadOccurrences(detail.workspace.id, { signal: controller.signal })
          : Promise.resolve({ items: [] } as WorkspaceReportOccurrenceListResponse),
      ]).then(([analysisResponse, occurrenceResponse]) => {
        if (generation !== requestGeneration.current || controller.signal.aborted) return;
        setAnalyses(analysisResponse.items);
        setOccurrences(occurrenceResponse.items);
      }).catch((reason: unknown) => {
        if (generation !== requestGeneration.current || controller.signal.aborted || (reason instanceof DOMException && reason.name === 'AbortError')) return;
        setDetail(undefined);
        setAnalyses([]);
        setSchedule(null);
        setOccurrences([]);
        setCompletedReports([]);
        setAvailableRepositories([]);
        setError(messageFor(reason));
      });
    }, pollIntervalMs);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [analyses, detail, loadAnalysis, loadOccurrences, occurrences, pollIntervalMs, selectedId]);

  const assignableRepositories = useMemo(() => {
    const assigned = new Set(detail?.repositories.map((item) => item.id));
    return availableRepositories.filter((item) => !assigned.has(item.id));
  }, [availableRepositories, detail?.repositories]);

  function beginMutation() {
    mutationController.current?.abort();
    const controller = new AbortController();
    mutationController.current = controller;
    return { controller, generation: requestGeneration.current };
  }

  function ownsMutation(controller: AbortController, generation: number) {
    return !controller.signal.aborted && mutationController.current === controller && requestGeneration.current === generation;
  }

  function clearProtectedState() {
    setDetail(undefined);
    setAnalyses([]);
    setSchedule(null);
    setOccurrences([]);
    setCompletedReports([]);
    setInvitations([]);
    setAvailableRepositories([]);
    setRenameName('');
    setUsername('');
    setRepositoryId('');
    setSelectedDays([]);
    setStatus(undefined);
    setSubmitting(false);
  }

  async function runManagerMutation<T>(workspaceId: string, operation: (signal: AbortSignal) => Promise<T>, accept: (response: T) => void) {
    const { controller, generation } = beginMutation();
    setSubmitting(true); setError(undefined); setStatus(undefined);
    try {
      const response = await operation(controller.signal);
      if (!ownsMutation(controller, generation)) return;
      accept(response);
    } catch (reason) {
      if (!ownsMutation(controller, generation)) return;
      if (isMembershipBoundaryFailure(reason)) {
        requestGeneration.current += 1;
        detailController.current?.abort();
        controller.abort();
        clearProtectedState();
        void openWorkspace(workspaceId);
        return;
      }
      setError(messageFor(reason));
    } finally {
      if (ownsMutation(controller, generation)) {
        mutationController.current = undefined;
        setSubmitting(false);
      }
    }
  }

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const windowStart = new Date(reportWindowStart);
    const windowEnd = new Date(reportWindowEnd);
    if (!Number.isFinite(windowStart.getTime()) || !Number.isFinite(windowEnd.getTime()) || windowStart >= windowEnd) {
      setError('Choose a report window whose end is after its start.');
      return;
    }
    const idempotencyKey = `manual-${Date.now()}-${++idempotencySequence.current}`;
    await runManagerMutation(detail.workspace.id,
      (signal) => generateReport(detail.workspace.id, { windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString() }, idempotencyKey, csrfToken, { signal }),
      (response) => {
        setOccurrences((current) => [response.occurrence, ...current.filter((item) => item.id !== response.occurrence.id)]);
        setStatus('Report generation requested. Status will update automatically.');
      });
  }

  async function handleBaseline(repositoryIdToStart: string) {
    if (!detail) return;
    await runManagerMutation(detail.workspace.id,
      (signal) => startBaseline(detail.workspace.id, repositoryIdToStart, csrfToken, { signal }),
      (response) => {
        setAnalyses((current) => current.map((item) => item.repositoryId === repositoryIdToStart ? response.analysis : item));
        setStatus(`Analysis ${response.run.kind === 'BASELINE' ? 'baseline' : 'refresh'} started for ${response.analysis.repositoryFullName}.`);
      });
  }

  async function handleSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    if (!validTimezone(timezone)) { setError('Enter a valid IANA timezone, such as UTC or America/Los_Angeles.'); return; }
    if (frequency === 'SELECTED_DAYS' && selectedDays.length === 0) { setError('Choose at least one weekday for a selected-days schedule.'); return; }
    const input: WorkspaceReportScheduleRequest = { enabled: true, frequency, selectedDays: frequency === 'SELECTED_DAYS' ? [...selectedDays].sort((a, b) => a - b) : [], localTime, timezone };
    await runManagerMutation(detail.workspace.id,
      (signal) => saveSchedule(detail.workspace.id, input, csrfToken, { signal }),
      (response) => { setSchedule(response.schedule); setStatus('Report schedule saved.'); });
  }

  async function handleDisableSchedule() {
    if (!detail) return;
    await runManagerMutation(detail.workspace.id,
      (signal) => disableSchedule(detail.workspace.id, csrfToken, { signal }),
      (response) => { setSchedule(response.schedule); setStatus('Report schedule disabled.'); });
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = workspaceName.trim();
    if (name.length < 2) {
      setError('Enter a workspace name with at least 2 characters.');
      return;
    }
    setSubmitting(true); setError(undefined); setStatus(undefined);
    try {
      const response = await createWorkspace({ name }, csrfToken);
      setWorkspaces((current) => [response.workspace, ...current]);
      setWorkspaceName('');
      setStatus(`Created ${response.workspace.name}.`);
    } catch (reason) { setError(messageFor(reason)); }
    finally { setSubmitting(false); }
  }

  async function handleInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const normalized = username.trim().toLowerCase();
    if (!normalized) { setError('Enter the existing Trace username to invite.'); return; }
    await runManagerMutation(detail.workspace.id,
      (signal) => createInvitation(detail.workspace.id, { username: normalized, role: memberRole }, csrfToken, { signal }),
      (response) => {
        setInvitations((current) => [response.invitation, ...current.filter((item) => item.id !== response.invitation.id)]);
        setCopyableInvitationPaths((current) => ({ ...current, [response.invitation.id]: response.copyablePath }));
        setUsername('');
        setStatus(`Invited @${response.invitation.invitedUser.username} as ${response.invitation.role === 'MANAGER' ? 'manager' : 'developer'}. Membership begins only after acceptance.`);
      });
  }

  async function handleRevokeInvitation(invitation: WorkspaceInvitation) {
    if (!detail || !window.confirm(`Revoke the invitation for @${invitation.invitedUser.username}?`)) return;
    await runManagerMutation(detail.workspace.id,
      (signal) => revokeInvitation(detail.workspace.id, invitation.id, csrfToken, { signal }),
      (response) => {
        setInvitations((current) => current.map((item) => item.id === response.invitation.id ? response.invitation : item));
        setStatus(`Revoked the invitation for @${response.invitation.invitedUser.username}.`);
      });
  }

  async function copyInvitationLink(invitation: WorkspaceInvitation, copyablePath: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${copyablePath}`);
      setStatus(`Copied the invitation link for @${invitation.invitedUser.username}.`);
      setError(undefined);
    } catch {
      setError('Trace could not copy the invitation link. Open it and copy the address from your browser.');
    }
  }

  async function handleRepository(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !repositoryId) { setError('Choose an available repository.'); return; }
    await runManagerMutation(detail.workspace.id,
      (signal) => assignRepository(detail.workspace.id, { repositoryId }, csrfToken, { signal }),
      (response) => {
      const isNewRepository = !detail.repositories.some((item) => item.id === response.repository.id);
      setDetail((current) => current ? {
        ...current,
        workspace: { ...current.workspace, repositoryCount: isNewRepository ? current.workspace.repositoryCount + 1 : current.workspace.repositoryCount },
        repositories: [...current.repositories.filter((item) => item.id !== response.repository.id), response.repository],
      } : current);
      if (isNewRepository) setWorkspaces((current) => current.map((workspace) => workspace.id === detail.workspace.id ? { ...workspace, repositoryCount: workspace.repositoryCount + 1 } : workspace));
      setRepositoryId('');
      setStatus(`Assigned ${response.repository.fullName}.`);
      });
  }

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const name = renameName.trim();
    if (name.length < 3) { setError('Enter a workspace name with at least 3 characters.'); return; }
    await runManagerMutation(detail.workspace.id,
      (signal) => updateWorkspace(detail.workspace.id, { name }, csrfToken, { signal }),
      (response) => {
      setDetail((current) => current ? { ...current, workspace: response.workspace } : current);
      setWorkspaces((current) => current.map((workspace) => workspace.id === response.workspace.id ? response.workspace : workspace));
      setRenameName(response.workspace.name);
      setStatus(`Renamed workspace to ${response.workspace.name}.`);
      });
  }

  async function handleRoleChange(userId: string, role: 'MANAGER' | 'DEVELOPER') {
    if (!detail) return;
    await runManagerMutation(detail.workspace.id,
      (signal) => updateMemberRole(detail.workspace.id, userId, { role }, csrfToken, { signal }),
      (response) => {
        setDetail((current) => current ? { ...current, members: current.members.map((member) => member.userId === userId ? response.member : member) } : current);
        setStatus(`Updated @${response.member.username} to ${role === 'MANAGER' ? 'manager' : 'developer'}.`);
      });
  }

  async function handleRemoveMember(userId: string, usernameToRemove: string) {
    if (!detail || !window.confirm(`Remove @${usernameToRemove} from this workspace?`)) return;
    await runManagerMutation(detail.workspace.id,
      async (signal) => { await removeMember(detail.workspace.id, userId, csrfToken, { signal }); },
      () => {
        setDetail((current) => current ? { ...current, workspace: { ...current.workspace, memberCount: current.workspace.memberCount - 1 }, members: current.members.filter((member) => member.userId !== userId) } : current);
        setWorkspaces((current) => current.map((workspace) => workspace.id === detail.workspace.id ? { ...workspace, memberCount: workspace.memberCount - 1 } : workspace));
        setStatus(`Removed @${usernameToRemove}.`);
      });
  }

  async function handleRemoveRepository(repositoryIdToRemove: string, fullName: string) {
    if (!detail || !window.confirm(`Remove ${fullName} from this workspace?`)) return;
    await runManagerMutation(detail.workspace.id,
      async (signal) => { await removeRepository(detail.workspace.id, repositoryIdToRemove, csrfToken, { signal }); },
      () => {
        setDetail((current) => current ? { ...current, workspace: { ...current.workspace, repositoryCount: current.workspace.repositoryCount - 1 }, repositories: current.repositories.filter((repository) => repository.id !== repositoryIdToRemove) } : current);
        setWorkspaces((current) => current.map((workspace) => workspace.id === detail.workspace.id ? { ...workspace, repositoryCount: workspace.repositoryCount - 1 } : workspace));
        setStatus(`Removed ${fullName}.`);
      });
  }

  async function handleArchive() {
    if (!detail || !window.confirm(`Archive ${detail.workspace.name}? This makes it read-only.`)) return;
    await runManagerMutation(detail.workspace.id,
      (signal) => archiveWorkspace(detail.workspace.id, csrfToken, { signal }),
      (response) => {
        setDetail((current) => current ? { ...current, workspace: response.workspace } : current);
        setWorkspaces((current) => current.map((workspace) => workspace.id === response.workspace.id ? response.workspace : workspace));
        setAvailableRepositories([]);
        setStatus(`Archived ${response.workspace.name}.`);
      });
  }

  return <div className="workspace-experience">
    {error ? <div className="inline-alert error" role="alert">{error}</div> : null}
    {status ? <div className="inline-alert success" role="status">{status}</div> : null}

    <section className="workspace-create-band" aria-labelledby="create-workspace-title">
      <div>
        <span className="eyebrow">Team boundary</span>
        <h2 id="create-workspace-title">Create a workspace</h2>
        <p>Group people and repositories without changing their GitHub permissions.</p>
      </div>
      <form className="workspace-create-form" onSubmit={handleCreate}>
        <label htmlFor="workspace-name">Workspace name</label>
        <div className="workspace-inline-controls">
          <input id="workspace-name" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} maxLength={100} placeholder="e.g. Product delivery" />
          <Button type="submit" disabled={submitting}>Create workspace</Button>
        </div>
      </form>
    </section>

    <section aria-labelledby="your-workspaces-title">
      <div className="section-heading-row">
        <div><span className="eyebrow">Access map</span><h2 id="your-workspaces-title">Your workspaces</h2></div>
        <Badge>{workspaces.length} total</Badge>
      </div>
      {loading ? <div className="workspace-grid" aria-label="Loading workspaces"><Card className="workspace-card skeleton-card" /></div>
        : workspaces.length === 0 ? <Card className="empty-state"><Building2 aria-hidden="true" /><h3>No workspaces yet</h3><p>Create one above to coordinate a team and its repositories.</p></Card>
        : <div className="workspace-grid">{workspaces.map((workspace) => <Card className={`workspace-card ${selectedId === workspace.id ? 'selected' : ''}`} key={workspace.id}>
          <div className="workspace-card-heading"><span className="workspace-icon"><Building2 size={20} aria-hidden="true" /></span><Badge>{roleLabel(workspace.role)}</Badge></div>
          <h3>{workspace.name}</h3>
          <p className="muted">{workspace.memberCount} {workspace.memberCount === 1 ? 'member' : 'members'} · {workspace.repositoryCount} {workspace.repositoryCount === 1 ? 'repository' : 'repositories'}</p>
          <Button className="secondary" onClick={() => void openWorkspace(workspace.id)} aria-label={`Open ${workspace.name}`}>Open workspace</Button>
        </Card>)}</div>}
    </section>

    {selectedId ? <section className="workspace-detail-region" aria-live="polite">
      {detailLoading ? <Card className="workspace-detail-card"><p>Loading workspace…</p></Card> : detail ? <Card className="workspace-detail-card">
        <div className="workspace-detail-header">
          <div><span className="eyebrow">{roleLabel(detail.workspace.role)}</span><h2>{detail.workspace.name}</h2><p>Shared visibility for the people and repositories in this delivery boundary.</p></div>
          <Button className="secondary" onClick={() => void openWorkspace(detail.workspace.id)} aria-label="Refresh workspace"><RefreshCw size={16} aria-hidden="true" />Refresh</Button>
        </div>
        <div className="workspace-detail-grid">
          <section aria-labelledby="workspace-members-title"><div className="subsection-heading"><Users size={18} aria-hidden="true" /><h3 id="workspace-members-title">Members</h3></div>
            <ul className="workspace-list">{detail.members.map((member) => <li key={member.userId}>
              <div><strong>{member.displayName ?? member.username}</strong><span>@{member.username}</span></div>
              {detail.workspace.role === 'MANAGER' && detail.workspace.archivedAt === null ? <div className="workspace-row-actions">
                <label className="sr-only" htmlFor={`workspace-member-role-${member.userId}`}>Role for @{member.username}</label>
                <select id={`workspace-member-role-${member.userId}`} aria-label={`Role for @${member.username}`} value={member.role} disabled={submitting} onChange={(event) => void handleRoleChange(member.userId, event.target.value as 'MANAGER' | 'DEVELOPER')}><option value="DEVELOPER">Developer</option><option value="MANAGER">Manager</option></select>
                <Button className="secondary" type="button" disabled={submitting} aria-label={`Remove @${member.username}`} onClick={() => void handleRemoveMember(member.userId, member.username)}>Remove</Button>
              </div> : <Badge>{member.role === 'MANAGER' ? 'Manager' : 'Developer'}</Badge>}
            </li>)}</ul>
          </section>
          <section aria-labelledby="workspace-repositories-title"><div className="subsection-heading"><FolderGit2 size={18} aria-hidden="true" /><h3 id="workspace-repositories-title">Repositories</h3></div>
            {detail.repositories.length === 0 ? <p className="muted">No repositories assigned yet.</p> : <ul className="workspace-list">{detail.repositories.map((repository) => { const safeUrl = safeGitHubUrl(repository.url); return <li key={repository.id}><div><strong>{safeUrl ? <Link href={safeUrl}>{repository.fullName}</Link> : repository.fullName}</strong><span>{repository.private ? 'Private' : 'Public'} · {repository.defaultBranch}{repository.accessState === 'ACCESS_REMOVED' ? ' · Access removed' : ''}</span></div>{detail.workspace.role === 'MANAGER' && detail.workspace.archivedAt === null ? <Button className="secondary" type="button" disabled={submitting} aria-label={`Remove repository ${repository.fullName}`} onClick={() => void handleRemoveRepository(repository.id, repository.fullName)}>Remove</Button> : null}</li>; })}</ul>}
          </section>
        </div>

        <section className="workspace-reporting" aria-labelledby="workspace-reporting-title">
          <div className="subsection-heading"><div><span className="eyebrow">Evidence lifecycle</span><h3 id="workspace-reporting-title">Workspace reports</h3></div></div>
          <div className="reporting-summary-grid">
            {detail.workspace.role === 'MANAGER' && detail.workspace.archivedAt === null ? <section aria-labelledby="repository-analysis-title">
              <h4 id="repository-analysis-title">Repository analysis</h4>
              {analyses.length === 0 ? <p className="muted">No repository analysis is available.</p> : <ul className="analysis-list">{analyses.map((item) => <li className="analysis-card" key={item.repositoryId}>
                <div className="report-status-row"><strong>{item.repositoryFullName}</strong><Badge>{item.accessState === 'ACCESS_REMOVED' ? 'Access removed' : titleCase(item.status)}</Badge></div>
                {item.coverage ? <p>{item.coverage.analyzedFiles} of {item.coverage.eligibleFiles} eligible files analyzed · {item.coverage.truncatedFiles} truncated</p> : <p>{item.status === 'UNINITIALIZED' ? 'No baseline has been analyzed yet.' : item.status === 'FAILED' ? 'Code analysis did not complete.' : 'Code analysis is in progress.'}</p>}
                {item.lastAnalyzedAt ? <p>Last analyzed {formatPakistanDateTime(item.lastAnalyzedAt)}</p> : null}
                {item.coverage && item.lastAnalyzedSha ? <details className="analysis-details">
                  <summary>View analysis details</summary>
                  <p><strong>{item.latestRun?.kind === 'INCREMENTAL' ? 'Incremental run' : 'Baseline run'}</strong></p>
                  <p>Commit {item.lastAnalyzedSha.slice(0, 8)}</p>
                  <p>{item.coverage.analyzedFiles} analyzed · {item.coverage.eligibleFiles} eligible · {item.coverage.excludedFiles} excluded · {item.coverage.truncatedFiles} truncated</p>
                  <p>{item.coverage.analyzedBytes.toLocaleString('en-US')} of {item.coverage.totalBytes.toLocaleString('en-US')} bytes analyzed</p>
                  {(item.latestRun?.completedAt ?? item.lastAnalyzedAt) ? <p>Completed {formatPakistanDateTime(item.latestRun?.completedAt ?? item.lastAnalyzedAt!)}</p> : null}
                </details> : null}
                {item.lastError ? <p className="report-failure">{item.lastError}</p> : null}
                {detail.workspace.role === 'MANAGER' && detail.workspace.archivedAt === null && item.accessState === 'ACTIVE'
                  ? <Button className="secondary" type="button" disabled={submitting || activeAnalysisStatuses.has(item.status)} aria-label={`${item.status === 'FAILED' ? 'Retry code analysis' : item.baselineSha ? 'Refresh analysis' : 'Start baseline'} for ${item.repositoryFullName}`} onClick={() => void handleBaseline(item.repositoryId)}>{item.status === 'FAILED' ? 'Retry code analysis' : item.baselineSha ? 'Refresh analysis' : 'Start baseline'}</Button>
                  : null}
              </li>)}</ul>}
            </section> : null}
            {detail.workspace.role === 'MANAGER' && detail.workspace.archivedAt === null ? <section aria-labelledby="report-schedule-status-title">
              <h4 id="report-schedule-status-title">Report schedule</h4>
              <p className="schedule-summary">{scheduleSummary(schedule)}</p>
            </section> : null}
          </div>

          {detail.workspace.role === 'DEVELOPER' || detail.workspace.archivedAt !== null ? <section aria-labelledby="completed-workspace-reports-title">
            <div className="section-heading-row"><h4 id="completed-workspace-reports-title">Completed reports</h4><Badge>{completedReports.length} available</Badge></div>
            {completedReports.length === 0 ? <p className="muted">No completed workspace reports are available yet.</p> : <ul className="occurrence-list">{completedReports.map((report) => {
              const date = new Date(`${report.reportDate}T12:00:00.000Z`).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' });
              return <li className="occurrence-card" key={report.id}><div className="report-status-row"><div><strong>{date}</strong><p>Revision {report.revision} · Completed {report.completedAt ? formatPakistanDateTime(report.completedAt) : ''}</p></div><Link aria-label={`Open completed report for ${date}`} href={`/workspaces/${encodeURIComponent(detail.workspace.id)}/reports/${encodeURIComponent(report.id)}`}>Open report</Link></div></li>;
            })}</ul>}
          </section> : null}

          {detail.workspace.role === 'MANAGER' && detail.workspace.archivedAt === null ? <div className="report-manager-grid">
            <form aria-label="Generate workspace report" onSubmit={handleGenerate}>
              <h4>Generate now</h4>
              <label htmlFor="report-window-start">Report window start</label>
              <input id="report-window-start" type="datetime-local" value={reportWindowStart} onChange={(event) => setReportWindowStart(event.target.value)} />
              <label htmlFor="report-window-end">Report window end</label>
              <input id="report-window-end" type="datetime-local" value={reportWindowEnd} onChange={(event) => setReportWindowEnd(event.target.value)} />
              <Button type="submit" disabled={submitting}>Generate now</Button>
            </form>
            <form aria-label="Report schedule" onSubmit={handleSchedule}>
              <h4>Schedule editor</h4>
              <label htmlFor="schedule-frequency">Schedule frequency</label>
              <select id="schedule-frequency" value={frequency} onChange={(event) => { const next = event.target.value as WorkspaceReportScheduleRequest['frequency']; setFrequency(next); if (next !== 'SELECTED_DAYS') setSelectedDays([]); }}>
                <option value="DAILY">Daily</option><option value="WEEKDAYS">Weekdays</option><option value="SELECTED_DAYS">Selected days</option>
              </select>
              {frequency === 'SELECTED_DAYS' ? <fieldset><legend>Selected weekdays</legend><div className="weekday-grid">{weekdays.map(([day, label]) => <label key={day}><input type="checkbox" checked={selectedDays.includes(day)} onChange={(event) => setSelectedDays((current) => event.target.checked ? [...current, day] : current.filter((value) => value !== day))} />{label}</label>)}</div></fieldset> : null}
              <label htmlFor="schedule-time">Local report time</label>
              <input id="schedule-time" type="time" value={localTime} onChange={(event) => setLocalTime(event.target.value)} required />
              <label htmlFor="schedule-timezone">IANA timezone</label>
              <input id="schedule-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/Los_Angeles" maxLength={100} />
              <div className="report-form-actions"><Button type="submit" disabled={submitting}>Save schedule</Button><Button className="secondary" type="button" disabled={submitting || !schedule?.enabled} onClick={() => void handleDisableSchedule()}>Disable schedule</Button></div>
            </form>
          </div> : null}

          {detail.workspace.role === 'MANAGER' && detail.workspace.archivedAt === null ? <section aria-labelledby="report-occurrences-title">
            <div className="section-heading-row"><h4 id="report-occurrences-title">Report status</h4><Badge>{occurrences.length} occurrences</Badge></div>
            {occurrences.length === 0 ? <p className="muted">No workspace reports have been requested.</p> : <ul className="occurrence-list">{occurrences.map((item) => <li key={item.id} className="occurrence-card">
              <div className="report-status-row"><div><Badge>{titleCase(item.trigger)}</Badge> <Badge>{titleCase(item.status)}</Badge></div>{item.reportId ? <Link href={`/workspaces/${encodeURIComponent(detail.workspace.id)}/reports/${encodeURIComponent(item.reportId)}`}>Open report</Link> : null}</div>
              <p><strong>Window</strong> {formatPakistanDateTime(item.windowStart)} – {formatPakistanDateTime(item.windowEnd)}</p>
              <p><strong>Data cutoff</strong> {formatPakistanDateTime(item.dataCutoffAt)}</p>
              {item.scheduledFor ? <p><strong>Scheduled for</strong> {formatPakistanDateTime(item.scheduledFor)}{item.intendedLocalDateTime ? ` (${item.intendedLocalDateTime} schedule-local)` : ''}</p> : null}
              {item.noActivity === true ? <p>No activity was found in this report window.</p> : item.noActivity === false ? <p>Activity was found in this report window.</p> : <p>Activity status is pending.</p>}
              {item.recoveredAt ? <p>Recovered after a missed scheduled run at {formatPakistanDateTime(item.recoveredAt)}.</p> : null}
              {item.error ? <p className="report-failure">{item.error}</p> : null}
            </li>)}</ul>}
          </section> : null}
        </section>

        {detail.workspace.archivedAt !== null ? <div className="developer-boundary"><ShieldCheck size={18} aria-hidden="true" /><div><strong>Archived workspace</strong><p>Archived workspaces are read-only. Historical members, repositories, reports, and evidence remain visible.</p></div></div>
          : detail.workspace.role === 'MANAGER' ? <section className="manager-tools" aria-labelledby="manager-tools-title">
          <div className="subsection-heading"><ShieldCheck size={18} aria-hidden="true" /><div><h3 id="manager-tools-title">Manager tools</h3><p>Manage this workspace without changing anyone’s GitHub permissions.</p></div></div>
          <div className="manager-tool-grid">
            <form onSubmit={handleRename}><h4>Workspace settings</h4><label htmlFor="workspace-rename">New workspace name</label><input id="workspace-rename" value={renameName} onChange={(event) => setRenameName(event.target.value)} maxLength={100} /><Button type="submit" disabled={submitting}>Save workspace name</Button><Button className="secondary" type="button" disabled={submitting} onClick={() => void handleArchive()}>Archive workspace</Button></form>
            <section className="workspace-invitation-tool" aria-labelledby="workspace-invite-title">
              <form onSubmit={handleInvitation}><h4 id="workspace-invite-title"><UserPlus size={16} aria-hidden="true" /> Invite colleague</h4><p className="field-help">They become a member only after accepting from their Trace account.</p><label htmlFor="workspace-username">Trace username</label><input id="workspace-username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="username" />
                <label htmlFor="workspace-role">Workspace role</label><select id="workspace-role" value={memberRole} onChange={(event) => setMemberRole(event.target.value as 'MANAGER' | 'DEVELOPER')}><option value="DEVELOPER">Developer</option><option value="MANAGER">Manager</option></select><Button type="submit" disabled={submitting}>Send invitation</Button></form>
              <div className="workspace-pending-invitations"><h4>Invitations</h4>{invitations.length === 0 ? <p className="muted">No invitations yet.</p> : <ul className="workspace-list">{invitations.map((invitation) => {
                const copyablePath = copyableInvitationPaths[invitation.id];
                return <li key={invitation.id}><div><strong>@{invitation.invitedUser.username}</strong><span>{invitation.role === 'MANAGER' ? 'Manager' : 'Developer'} · {titleCase(invitation.status)}</span></div><div className="workspace-row-actions">{copyablePath ? <Button className="secondary" type="button" disabled={submitting} aria-label={`Copy invitation link for @${invitation.invitedUser.username}`} onClick={() => void copyInvitationLink(invitation, copyablePath)}>Copy link</Button> : null}{invitation.status === 'PENDING' ? <Button className="secondary" type="button" disabled={submitting} aria-label={`Revoke invitation for @${invitation.invitedUser.username}`} onClick={() => void handleRevokeInvitation(invitation)}>Revoke</Button> : null}</div></li>;
              })}</ul>}</div>
            </section>
            <form onSubmit={handleRepository}><h4><FolderGit2 size={16} aria-hidden="true" /> Assign repository</h4><label htmlFor="workspace-repository">Repository</label><select id="workspace-repository" value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}><option value="">Choose a repository</option>{assignableRepositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.fullName}</option>)}</select><p className="field-help">Only active repositories authorized for your account appear here.</p><Button type="submit" disabled={submitting || assignableRepositories.length === 0}>Assign repository</Button></form>
          </div>
        </section> : <div className="developer-boundary"><ShieldCheck size={18} aria-hidden="true" /><div><strong>Developer access is read-only</strong><p>You can review this workspace. A manager controls membership and repository assignments.</p></div></div>}
      </Card> : null}
    </section> : null}
  </div>;
}
