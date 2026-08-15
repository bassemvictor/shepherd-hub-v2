import { ChevronDown, FileSpreadsheet, Loader2, MapPinned, RefreshCcw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AdminJobsResponse,
  CreateHouseholdGeocodeJobInput,
  HouseholdGeocodeJob,
  HouseholdGeocodeJobMode,
  MemberImportJob,
} from "../../shared/types";
import { ErrorState } from "../components/states/error-state";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { api, getDisplayErrorMessage, isApiConfigured } from "../lib/api";
import { cn } from "../lib/utils";
import { ToastStack, type ToastItem } from "./calendar-shared";

const activeImportJobStorageKey = "members-import-job-id";
const activeGeocodeJobStorageKey = "admin-household-geocode-job-id";

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });

const jobModeCopy: Record<HouseholdGeocodeJobMode, { title: string; description: string; shortLabel: string }> = {
  unmapped_only: {
    title: "Geocode Unmapped Households",
    description: "Geocode households that don't have geographic coordinates.",
    shortLabel: "Geocode Unmapped",
  },
  retry_failed: {
    title: "Retry Failed Households",
    description: "Retry geocoding for households that previously failed.",
    shortLabel: "Retry Failed",
  },
};

const emptyImportResult = {
  created: 0,
  updated: 0,
  skipped: 0,
  householdsCreated: 0,
  householdsMatched: 0,
  membersAssignedToHouseholds: 0,
  membersWithoutHouseholds: 0,
  householdConflicts: 0,
  errorCount: 0,
  errors: [],
};

const getImportResult = (job: MemberImportJob) => ({
  ...emptyImportResult,
  ...(job.result ?? {}),
});

const isActiveJobStatus = (status: string) => status === "queued" || status === "running";

const formatDateTime = (value?: string) => {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
};

type NormalizedJob = {
  id: string;
  kind: "member_import" | "geocode_unmapped" | "retry_failed";
  title: string;
  subtitle: string;
  startedAt?: string;
  completedAt?: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progressCurrent?: number;
  progressTotal?: number;
  progressPercent?: number | null;
  resultLines: string[];
  detailRows: Array<{ label: string; value: string }>;
};

const createProgressPercent = (current?: number, total?: number) => {
  if (typeof current !== "number" || typeof total !== "number" || total <= 0) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
};

const normalizeMemberImportJob = (job: MemberImportJob): NormalizedJob => {
  const result = getImportResult(job);

  return {
    id: job.jobId,
    kind: "member_import",
    title: job.fileName,
    subtitle: "Member Import",
    startedAt: job.startedAt ?? job.createdAt,
    completedAt: job.completedAt,
    status: job.status,
    progressCurrent: job.processedRows,
    progressTotal: job.totalRows,
    progressPercent: createProgressPercent(job.processedRows, job.totalRows),
    resultLines: [
      `${result.created} created · ${result.updated} updated`,
      `${result.skipped} skipped · ${result.errorCount} errors`,
      `${result.householdsCreated} households created · ${result.householdsMatched} matched · ${result.membersAssignedToHouseholds} assigned`,
    ],
    detailRows: [
      { label: "Job ID", value: job.jobId },
      { label: "Started", value: formatDateTime(job.startedAt ?? job.createdAt) },
      { label: "Finished", value: formatDateTime(job.completedAt) },
      { label: "Rows", value: `${job.processedRows} / ${job.totalRows}` },
      { label: "Chunks", value: `${job.processedChunks} / ${job.totalChunks}` },
      { label: "Created", value: String(result.created) },
      { label: "Updated", value: String(result.updated) },
      { label: "Skipped", value: String(result.skipped) },
      { label: "Errors", value: String(result.errorCount) },
      { label: "Households Created", value: String(result.householdsCreated) },
      { label: "Households Matched", value: String(result.householdsMatched) },
      { label: "Members Assigned", value: String(result.membersAssignedToHouseholds) },
    ],
  };
};

const normalizeGeocodeJob = (job: HouseholdGeocodeJob): NormalizedJob => {
  const hasWork = job.total > 0;
  const resultLine = hasWork
    ? `${job.success} succeeded · ${job.failed} failed`
    : job.mode === "retry_failed"
      ? "Nothing to retry"
      : "Nothing to geocode";

  return {
    id: job.jobId,
    kind: job.mode === "retry_failed" ? "retry_failed" : "geocode_unmapped",
    title: job.mode === "retry_failed" ? "Retry failed" : "Geocode unmapped",
    subtitle: jobModeCopy[job.mode].title,
    startedAt: job.startedAt ?? job.createdAt,
    completedAt: job.completedAt,
    status: job.status,
    progressCurrent: hasWork ? job.processed : undefined,
    progressTotal: hasWork ? job.total : undefined,
    progressPercent: hasWork ? createProgressPercent(job.processed, job.total) : null,
    resultLines: [resultLine],
    detailRows: [
      { label: "Job ID", value: job.jobId },
      { label: "Started", value: formatDateTime(job.startedAt ?? job.createdAt) },
      { label: "Finished", value: formatDateTime(job.completedAt) },
      { label: "Processed", value: `${job.processed} / ${job.total}` },
      { label: "Remaining", value: String(job.remaining) },
      { label: "Succeeded", value: String(job.success) },
      { label: "Failed", value: String(job.failed) },
      { label: "Last Failure", value: job.lastFailureReason ?? "None" },
    ],
  };
};

const statusTone = (status: NormalizedJob["status"]) => {
  if (status === "completed") {
    return "success" as const;
  }

  if (status === "cancelled") {
    return "neutral" as const;
  }

  if (status === "failed") {
    return "warning" as const;
  }

  return "neutral" as const;
};

const statusLabel = (status: NormalizedJob["status"]) => {
  if (status === "running") {
    return "Running";
  }

  if (status === "queued") {
    return "Queued";
  }

  if (status === "failed") {
    return "Failed";
  }

  if (status === "cancelled") {
    return "Cancelled";
  }

  return "Completed";
};

const renderStatusIcon = (status: NormalizedJob["status"]) => {
  if (status === "completed") {
    return "✓";
  }

  if (status === "failed") {
    return "!";
  }

  if (status === "cancelled") {
    return "×";
  }

  return "●";
};

const JobProgress = ({ current, total, percent }: { current?: number; total?: number; percent?: number | null }) => {
  if (typeof current !== "number" || typeof total !== "number" || total <= 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  const safePercent = percent ?? createProgressPercent(current, total) ?? 0;

  return (
    <div className="min-w-[140px] space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{current} / {total}</span>
        <span>{safePercent}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-primary/75 transition-[width]" style={{ width: `${safePercent}%` }} />
      </div>
    </div>
  );
};

export const AdminJobsPage = () => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [jobs, setJobs] = useState<AdminJobsResponse | null>(null);
  const [importJob, setImportJob] = useState<MemberImportJob | null>(null);
  const [geocodeJob, setGeocodeJob] = useState<HouseholdGeocodeJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [importing, setImporting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [runningMode, setRunningMode] = useState<HouseholdGeocodeJobMode | null>(null);
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [expandedJobs, setExpandedJobs] = useState<Record<string, boolean>>({});

  const pushToast = useCallback((tone: ToastItem["tone"], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3200);
  }, []);

  const loadJobs = useCallback(async () => {
    const nextJobs = await api.get<AdminJobsResponse>("/admin/jobs");
    setJobs(nextJobs);
    setImportJob((current) => {
      if (current) {
        const updated = nextJobs.memberImportJobs.find((job) => job.jobId === current.jobId);
        if (updated) {
          return updated;
        }
      }

      return nextJobs.memberImportJobs.find((job) => isActiveJobStatus(job.status)) ?? current;
    });
    setGeocodeJob((current) => {
      if (current) {
        const updated = nextJobs.householdGeocodeJobs.find((job) => job.jobId === current.jobId);
        if (updated) {
          return updated;
        }
      }

      return nextJobs.householdGeocodeJobs.find((job) => isActiveJobStatus(job.status)) ?? current;
    });
  }, []);

  const refreshAll = useCallback(async () => {
    setError(null);
    try {
      await loadJobs();
    } catch (reason) {
      setError(getDisplayErrorMessage(reason, "Unable to refresh admin jobs."));
    }
  }, [loadJobs]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        await loadJobs();
      } catch (reason) {
        if (!active) {
          return;
        }

        setError(getDisplayErrorMessage(reason, "Unable to load admin jobs."));
      } finally {
        if (active) {
          setLoadingJobs(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [loadJobs]);

  useEffect(() => {
    const persistedImportJobId = window.sessionStorage.getItem(activeImportJobStorageKey);
    const persistedGeocodeJobId = window.sessionStorage.getItem(activeGeocodeJobStorageKey);
    if (!persistedImportJobId && !persistedGeocodeJobId) {
      return;
    }

    let active = true;
    void (async () => {
      try {
        const [nextImportJob, nextGeocodeJob] = await Promise.all([
          persistedImportJobId ? api.get<MemberImportJob>(`/members/import/${persistedImportJobId}`) : Promise.resolve(null),
          persistedGeocodeJobId ? api.get<HouseholdGeocodeJob>(`/admin/household-geocoding/${persistedGeocodeJobId}`) : Promise.resolve(null),
        ]);

        if (!active) {
          return;
        }

        if (nextImportJob) {
          setImportJob(nextImportJob);
          if (!isActiveJobStatus(nextImportJob.status)) {
            window.sessionStorage.removeItem(activeImportJobStorageKey);
          }
        }

        if (nextGeocodeJob) {
          setGeocodeJob(nextGeocodeJob);
          if (!isActiveJobStatus(nextGeocodeJob.status)) {
            window.sessionStorage.removeItem(activeGeocodeJobStorageKey);
          }
        }

        await loadJobs();
      } catch {
        if (!active) {
          return;
        }

        window.sessionStorage.removeItem(activeImportJobStorageKey);
        window.sessionStorage.removeItem(activeGeocodeJobStorageKey);
      }
    })();

    return () => {
      active = false;
    };
  }, [loadJobs]);

  const handleImport = useCallback(async () => {
    if (!selectedFile) {
      return;
    }

    setImporting(true);
    setError(null);
    try {
      const workbookBase64 = await fileToBase64(selectedFile);
      const nextJob = await api.post<MemberImportJob>("/members/import", {
        fileName: selectedFile.name,
        workbookBase64,
      });
      setImportJob(nextJob);
      setSelectedFile(null);
      window.sessionStorage.setItem(activeImportJobStorageKey, nextJob.jobId);
      await loadJobs();
      pushToast("success", `Member import started for ${selectedFile.name}.`);
    } catch (reason) {
      const message = getDisplayErrorMessage(reason, "Unable to import members.");
      setError(message);
      pushToast("error", message);
    } finally {
      setImporting(false);
    }
  }, [loadJobs, pushToast, selectedFile]);

  const startGeocodeJob = useCallback(async (mode: HouseholdGeocodeJobMode) => {
    setRunningMode(mode);
    setError(null);
    try {
      const nextJob = await api.post<HouseholdGeocodeJob>("/admin/household-geocoding", {
        mode,
      } satisfies CreateHouseholdGeocodeJobInput);
      setGeocodeJob(nextJob);
      window.sessionStorage.setItem(activeGeocodeJobStorageKey, nextJob.jobId);
      await loadJobs();
      pushToast("success", `${jobModeCopy[mode].title} started.`);
    } catch (reason) {
      const message = getDisplayErrorMessage(reason, "Unable to start household geocoding.");
      setError(message);
      pushToast("error", message);
    } finally {
      setRunningMode(null);
    }
  }, [loadJobs, pushToast]);

  const cancelJob = useCallback(async (job: NormalizedJob) => {
    setCancellingJobId(job.id);
    setError(null);
    try {
      if (job.kind === "member_import") {
        const nextJob = await api.post<MemberImportJob>(`/members/import/${job.id}/cancel`);
        setImportJob((current) => (current?.jobId === nextJob.jobId ? nextJob : current));
        window.sessionStorage.removeItem(activeImportJobStorageKey);
      } else {
        const nextJob = await api.post<HouseholdGeocodeJob>(`/admin/household-geocoding/${job.id}/cancel`);
        setGeocodeJob((current) => (current?.jobId === nextJob.jobId ? nextJob : current));
        window.sessionStorage.removeItem(activeGeocodeJobStorageKey);
      }

      await loadJobs();
      pushToast("success", `${job.subtitle} cancelled.`);
    } catch (reason) {
      const message = getDisplayErrorMessage(reason, `Unable to cancel ${job.subtitle.toLowerCase()}.`);
      setError(message);
      pushToast("error", message);
    } finally {
      setCancellingJobId(null);
    }
  }, [loadJobs, pushToast]);

  useEffect(() => {
    if (!importJob || !isActiveJobStatus(importJob.status)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void api.get<MemberImportJob>(`/members/import/${importJob.jobId}`).then(async (nextJob) => {
        setImportJob(nextJob);
        if (!isActiveJobStatus(nextJob.status)) {
          window.sessionStorage.removeItem(activeImportJobStorageKey);
          const result = getImportResult(nextJob);
          pushToast(
            result.errorCount > 0 ? "error" : "success",
            `Member import completed. ${result.created} created, ${result.updated} updated.`,
          );
        }
        await loadJobs();
      }).catch((reason) => {
        const message = getDisplayErrorMessage(reason, "Unable to refresh member import status.");
        setError(message);
        pushToast("error", message);
      });
    }, 1200);

    return () => window.clearTimeout(timeoutId);
  }, [importJob, loadJobs, pushToast]);

  useEffect(() => {
    if (!geocodeJob || !isActiveJobStatus(geocodeJob.status)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void api.get<HouseholdGeocodeJob>(`/admin/household-geocoding/${geocodeJob.jobId}`).then(async (nextJob) => {
        setGeocodeJob(nextJob);
        if (!isActiveJobStatus(nextJob.status)) {
          window.sessionStorage.removeItem(activeGeocodeJobStorageKey);
          pushToast(
            nextJob.failed > 0 ? "error" : "success",
            `Household geocoding completed. ${nextJob.success} succeeded, ${nextJob.failed} failed.`,
          );
        }
        await loadJobs();
      }).catch((reason) => {
        const message = getDisplayErrorMessage(reason, "Unable to refresh geocoding progress.");
        setError(message);
        pushToast("error", message);
      });
    }, 1250);

    return () => window.clearTimeout(timeoutId);
  }, [geocodeJob, loadJobs, pushToast]);

  const recentJobs = useMemo(
    () => [
      ...(jobs?.memberImportJobs.map(normalizeMemberImportJob) ?? []),
      ...(jobs?.householdGeocodeJobs.map(normalizeGeocodeJob) ?? []),
    ].sort((left, right) => (right.startedAt ?? "").localeCompare(left.startedAt ?? "")),
    [jobs],
  );

  const activeImportRunning = Boolean(importJob && isActiveJobStatus(importJob.status));
  const activeGeocodeRunning = Boolean(geocodeJob && isActiveJobStatus(geocodeJob.status));
  const unmappedCount = jobs?.householdGeocodeCounts.unmapped ?? 0;
  const failedCount = jobs?.householdGeocodeCounts.failed ?? 0;

  if (!isApiConfigured) {
    return <ErrorState description="Configure the API before using admin tools." title="API not configured" />;
  }

  return (
    <>
      <ToastStack toasts={toasts} />
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-foreground">Admin Jobs</h1>
            <p className="text-sm text-muted-foreground">Run and monitor administrative background jobs.</p>
          </div>
          <Button
            disabled={loadingJobs}
            onClick={() => void refreshAll()}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCcw className={cn("h-3.5 w-3.5", loadingJobs && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {error ? <ErrorState description={error} title="Admin job action failed" /> : null}

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Run a Job</CardTitle>
              <CardDescription>Start background jobs without leaving the admin area.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-0">
            <input
              accept=".xls,.xlsx"
              className="hidden"
              onChange={(event) => {
                setSelectedFile(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
              ref={inputRef}
              type="file"
            />

            <div className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0 flex items-start gap-3">
                <div className="rounded-md bg-slate-100 p-2 text-slate-600">
                  <FileSpreadsheet className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">Member Import</div>
                  <div className="text-sm text-muted-foreground">
                    Import members from a Unity Excel file. Households are automatically created or matched.
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="truncate text-xs text-muted-foreground sm:max-w-[220px]">
                  {selectedFile ? selectedFile.name : "No file selected"}
                </div>
                <Button onClick={() => inputRef.current?.click()} size="sm" type="button" variant="outline">
                  Choose Excel file
                </Button>
                <Button
                  disabled={!selectedFile || importing || activeImportRunning}
                  onClick={() => void handleImport()}
                  size="sm"
                  type="button"
                >
                  {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Start Import
                </Button>
              </div>
            </div>

            <div className="border-t border-border/70" />

            <div className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0 flex items-start gap-3">
                <div className="rounded-md bg-slate-100 p-2 text-slate-600">
                  <MapPinned className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">Geocode Unmapped Households</div>
                  <div className="text-sm text-muted-foreground">{jobModeCopy.unmapped_only.description}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 self-start sm:self-center">
                <div className="text-sm text-slate-600">{unmappedCount} unmapped</div>
                <Button
                  disabled={runningMode !== null || unmappedCount === 0}
                  onClick={() => void startGeocodeJob("unmapped_only")}
                  size="sm"
                  title={unmappedCount === 0 ? "No unmapped households" : undefined}
                  type="button"
                >
                  Geocode Unmapped
                </Button>
              </div>
            </div>

            <div className="border-t border-border/70" />

            <div className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0 flex items-start gap-3">
                <div className="rounded-md bg-slate-100 p-2 text-slate-600">
                  <RotateCcw className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">Retry Failed Households</div>
                  <div className="text-sm text-muted-foreground">{jobModeCopy.retry_failed.description}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 self-start sm:self-center">
                <div className="text-sm text-amber-700">{failedCount} failed</div>
                <Button
                  disabled={runningMode !== null || failedCount === 0 || activeGeocodeRunning}
                  onClick={() => void startGeocodeJob("retry_failed")}
                  size="sm"
                  title={failedCount === 0 ? "No failed households" : undefined}
                  type="button"
                  variant="outline"
                >
                  Retry Failed
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent Jobs</CardTitle>
              <CardDescription>Most recent administrative jobs across imports and household geocoding.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {loadingJobs ? (
              <div className="py-4 text-sm text-muted-foreground">Loading jobs…</div>
            ) : recentJobs.length ? (
              <>
                <div className="hidden rounded-md border border-border/70 bg-slate-50 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground md:grid md:grid-cols-[minmax(0,2.3fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.8fr)_minmax(0,1fr)_auto] md:gap-3">
                  <div>Job</div>
                  <div>Type</div>
                  <div>Started</div>
                  <div>Progress</div>
                  <div>Result</div>
                  <div>Status</div>
                  <div>Actions</div>
                </div>
                <div className="divide-y divide-border/70">
                  {recentJobs.map((job) => {
                    const expanded = Boolean(expandedJobs[job.id]);

                    return (
                      <div className="py-3" key={job.id}>
                        <div className="hidden md:grid md:grid-cols-[minmax(0,2.3fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.8fr)_minmax(0,1fr)_auto] md:items-start md:gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">{job.title}</div>
                            <div className="truncate text-xs text-muted-foreground">{job.id}</div>
                          </div>
                          <div className="text-sm text-muted-foreground">{job.subtitle}</div>
                          <div className="text-sm text-muted-foreground">{formatDateTime(job.startedAt)}</div>
                          <JobProgress current={job.progressCurrent} percent={job.progressPercent} total={job.progressTotal} />
                          <div className="space-y-1">
                            {job.resultLines.map((line) => (
                              <div className="text-sm text-muted-foreground" key={line}>{line}</div>
                            ))}
                          </div>
                          <div>
                            <Badge className="gap-1" variant={statusTone(job.status)}>
                              <span>{renderStatusIcon(job.status)}</span>
                              {statusLabel(job.status)}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-end gap-1">
                            {(job.status === "queued" || job.status === "running") ? (
                              <Button
                                disabled={cancellingJobId === job.id}
                                onClick={() => void cancelJob(job)}
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                {cancellingJobId === job.id ? "Cancelling..." : "Cancel"}
                              </Button>
                            ) : null}
                            <Button
                              onClick={() => setExpandedJobs((current) => ({ ...current, [job.id]: !expanded }))}
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              Details
                              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2 md:hidden">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground">{job.title}</div>
                              <div className="text-xs text-muted-foreground">{job.subtitle}</div>
                            </div>
                            <Badge className="gap-1" variant={statusTone(job.status)}>
                              <span>{renderStatusIcon(job.status)}</span>
                              {statusLabel(job.status)}
                            </Badge>
                          </div>
                          <div className="text-sm text-muted-foreground">{formatDateTime(job.startedAt)}</div>
                          <JobProgress current={job.progressCurrent} percent={job.progressPercent} total={job.progressTotal} />
                          <div className="space-y-1">
                            {job.resultLines.map((line) => (
                              <div className="text-sm text-muted-foreground" key={line}>{line}</div>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            {(job.status === "queued" || job.status === "running") ? (
                              <Button
                                className="px-0"
                                disabled={cancellingJobId === job.id}
                                onClick={() => void cancelJob(job)}
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                {cancellingJobId === job.id ? "Cancelling..." : "Cancel"}
                              </Button>
                            ) : null}
                            <Button
                              className="px-0"
                              onClick={() => setExpandedJobs((current) => ({ ...current, [job.id]: !expanded }))}
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              Details
                              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
                            </Button>
                          </div>
                        </div>

                        {expanded ? (
                          <div className="mt-3 rounded-md border border-border/70 bg-slate-50 px-3 py-3">
                            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                              {job.detailRows.map((row) => (
                                <div className="text-sm" key={`${job.id}-${row.label}`}>
                                  <span className="text-muted-foreground">{row.label}: </span>
                                  <span className="font-medium text-foreground">{row.value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="py-4 text-sm text-muted-foreground">No jobs have run yet.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
};
