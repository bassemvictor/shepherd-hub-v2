import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { SampleRecord, SampleRecordInput, SampleRecordListResponse } from "../../shared/types";
import { ConfirmDialog } from "../components/common/confirm-dialog";
import { DataGrid, type DataGridColumn } from "../components/common/data-grid";
import { FormDrawer } from "../components/common/form-drawer";
import { PageHeader } from "../components/common/page-header";
import { RightSideDrawer } from "../components/common/right-side-drawer";
import { StatusBadge } from "../components/common/status-badge";
import { ErrorState } from "../components/states/error-state";
import { LoadingState } from "../components/states/loading-state";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { api, isApiConfigured } from "../lib/api";

type DrawerMode = "create" | "edit" | "view";

const emptyForm = (): SampleRecordInput => ({
  name: "",
  owner: "",
  status: "draft",
});

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export const SampleRecordsPage = () => {
  const [records, setRecords] = useState<SampleRecord[]>([]);
  const [loading, setLoading] = useState(isApiConfigured);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SampleRecord["status"]>("all");
  const [selectedRecord, setSelectedRecord] = useState<SampleRecord | null>(null);
  const [drawerMode, setDrawerMode] = useState<DrawerMode | null>(null);
  const [form, setForm] = useState<SampleRecordInput>(emptyForm());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const loadRecords = async () => {
    setLoading(true);
    try {
      const response = await api.get<SampleRecordListResponse>("/records");
      setRecords(response.items);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isApiConfigured) {
      return;
    }

    void loadRecords();
  }, []);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const matchesQuery =
        !query ||
        record.name.toLowerCase().includes(query.toLowerCase()) ||
        record.owner.toLowerCase().includes(query.toLowerCase());
      const matchesStatus = statusFilter === "all" || record.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [query, records, statusFilter]);

  const openCreate = () => {
    setSelectedRecord(null);
    setForm(emptyForm());
    setDrawerMode("create");
  };

  const openEdit = (record: SampleRecord) => {
    setSelectedRecord(record);
    setForm({
      name: record.name,
      owner: record.owner,
      status: record.status,
    });
    setDrawerMode("edit");
  };

  const openView = (record: SampleRecord) => {
    setSelectedRecord(record);
    setDrawerMode("view");
  };

  const closeDrawers = () => {
    setDrawerMode(null);
    setSelectedRecord(null);
    setForm(emptyForm());
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.owner.trim()) {
      setError("Name and owner are required.");
      return;
    }

    setSaving(true);
    try {
      if (drawerMode === "edit" && selectedRecord) {
        await api.put<SampleRecord>(`/records/${selectedRecord.recordId}`, form);
      } else {
        await api.post<SampleRecord>("/records", form);
      }

      await loadRecords();
      closeDrawers();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save record.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedRecord) {
      return;
    }

    setDeleting(true);
    try {
      await api.delete(`/records/${selectedRecord.recordId}`);
      await loadRecords();
      setConfirmDeleteOpen(false);
      closeDrawers();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete record.");
    } finally {
      setDeleting(false);
    }
  };

  const columns: DataGridColumn<SampleRecord>[] = [
    {
      key: "name",
      header: "Name",
      cell: (record) => (
        <div>
          <p className="font-medium text-slate-900">{record.name}</p>
          <p className="text-xs text-muted-foreground">{record.recordId}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (record) => <StatusBadge status={record.status} />,
    },
    {
      key: "owner",
      header: "Owner",
      cell: (record) => record.owner,
    },
    {
      key: "createdAt",
      header: "Created Date",
      cell: (record) => formatDate(record.createdAt),
    },
    {
      key: "updatedAt",
      header: "Updated Date",
      cell: (record) => formatDate(record.updatedAt),
    },
    {
      key: "actions",
      header: "Actions",
      className: "w-[180px]",
      cell: (record) => (
        <div className="flex flex-wrap gap-1">
          <Button onClick={() => openView(record)} size="sm" type="button" variant="ghost">
            <Eye className="h-4 w-4" />
            View
          </Button>
          <Button onClick={() => openEdit(record)} size="sm" type="button" variant="ghost">
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          <Button
            onClick={() => {
              setSelectedRecord(record);
              setConfirmDeleteOpen(true);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        action={{ label: "Create Record", onClick: openCreate }}
        description="This page demonstrates the reusable table, right-side drawer pattern, and CRUD calls through API Gateway and Lambda."
        title="Sample Records"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px]">
          <Input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or owner"
            value={query}
          />
          <Select
            onChange={(event) => setStatusFilter(event.target.value as "all" | SampleRecord["status"])}
            value={statusFilter}
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </Select>
        </div>
      </PageHeader>

      {!isApiConfigured ? (
        <ErrorState
          description="Set `VITE_API_BASE_URL` or regenerate `amplify_outputs.json` before calling the sample backend."
          title="API not configured"
        />
      ) : loading ? (
        <LoadingState
          description="Loading sample records from the backend."
          title="Fetching records"
        />
      ) : error ? (
        <ErrorState
          action={
            <Button onClick={() => void loadRecords()} type="button">
              Retry
            </Button>
          }
          description={error}
          title="Unable to load records"
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <DataGrid
              columns={columns}
              emptyDescription="Create a record to see the reusable grid and drawer pattern in action."
              emptyTitle="No sample records yet"
              getRowKey={(record) => record.recordId}
              rows={filteredRecords}
            />
          </CardContent>
        </Card>
      )}

      <FormDrawer
        busy={saving}
        description="Use this drawer as the starter pattern for create and edit forms."
        onClose={closeDrawers}
        onSubmit={() => void handleSave()}
        open={drawerMode === "create" || drawerMode === "edit"}
        submitLabel={drawerMode === "edit" ? "Save Changes" : "Create Record"}
        title={drawerMode === "edit" ? "Edit Record" : "Create Record"}
      >
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <label className="text-sm font-medium text-slate-800">Name</label>
            <Input
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Record name"
              value={form.name}
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-sm font-medium text-slate-800">Status</label>
            <Select
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  status: event.target.value as SampleRecord["status"],
                }))
              }
              value={form.status}
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <label className="text-sm font-medium text-slate-800">Owner</label>
            <Input
              onChange={(event) => setForm((current) => ({ ...current, owner: event.target.value }))}
              placeholder="Owner name"
              value={form.owner}
            />
          </div>
        </div>
      </FormDrawer>

      <RightSideDrawer
        description="This read-only drawer shows the same layout pattern without form controls."
        onClose={closeDrawers}
        open={drawerMode === "view" && Boolean(selectedRecord)}
        title="Record Details"
      >
        {selectedRecord ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Name</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{selectedRecord.name}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Status</p>
              <div className="mt-2">
                <StatusBadge status={selectedRecord.status} />
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Owner</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{selectedRecord.owner}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Created</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{formatDate(selectedRecord.createdAt)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Updated</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{formatDate(selectedRecord.updatedAt)}</p>
              </div>
            </div>
          </div>
        ) : null}
      </RightSideDrawer>

      <ConfirmDialog
        busy={deleting}
        confirmLabel="Delete Record"
        description="This permanently removes the sample record from DynamoDB."
        destructive
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => void handleDelete()}
        open={confirmDeleteOpen}
        title="Delete sample record?"
      />
    </div>
  );
};
