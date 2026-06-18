import { Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { AdminManagedGroup, TenantUserSummary, TenantUsersResponse, UpdateTenantUserGroupsResponse } from "../../shared/types";
import { PageHeader } from "../components/common/page-header";
import { ErrorState } from "../components/states/error-state";
import { LoadingState } from "../components/states/loading-state";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { api, isApiConfigured } from "../lib/api";
import { formatGroupLabel, useAuth } from "../lib/auth";
import { ToastStack, type ToastItem } from "./calendar-shared";

const managedGroups: AdminManagedGroup[] = ["admin", "priest", "servant"];

export const AdminUserGroupsPage = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState<TenantUserSummary[]>([]);
  const [drafts, setDrafts] = useState<Record<string, AdminManagedGroup[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingUsername, setSavingUsername] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback((tone: ToastItem["tone"], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3200);
  }, []);

  const hydrateUsers = useCallback((items: TenantUserSummary[]) => {
    setUsers(items);
    setDrafts(
      Object.fromEntries(
        items.map((item) => [
          item.username,
          item.groups.filter((group): group is AdminManagedGroup => managedGroups.includes(group as AdminManagedGroup)),
        ]),
      ),
    );
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<TenantUsersResponse>("/admin/users");
      hydrateUsers(response.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load tenant users.");
    } finally {
      setLoading(false);
    }
  }, [hydrateUsers]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const updateDraft = useCallback((username: string, group: AdminManagedGroup, checked: boolean) => {
    setDrafts((current) => {
      const next = new Set(current[username] ?? []);
      if (checked) {
        next.add(group);
      } else {
        next.delete(group);
      }
      return {
        ...current,
        [username]: managedGroups.filter((entry) => next.has(entry)),
      };
    });
  }, []);

  const saveGroups = useCallback(async (tenantUser: TenantUserSummary) => {
    setSavingUsername(tenantUser.username);
    setError(null);
    try {
      const response = await api.put<UpdateTenantUserGroupsResponse>(
        `/admin/users/${encodeURIComponent(tenantUser.username)}/groups`,
        { groups: drafts[tenantUser.username] ?? [] },
      );
      hydrateUsers(users.map((item) => (item.username === response.user.username ? response.user : item)));
      pushToast("success", `Updated groups for ${response.user.name}.`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to update user groups.";
      setError(message);
      pushToast("error", message);
    } finally {
      setSavingUsername(null);
    }
  }, [drafts, hydrateUsers, pushToast, users]);

  const rows = useMemo(
    () =>
      users.map((tenantUser) => {
        const draftGroups = drafts[tenantUser.username] ?? [];
        const hasChanges =
          JSON.stringify([...draftGroups].sort()) !==
          JSON.stringify(
            tenantUser.groups
              .filter((group): group is AdminManagedGroup => managedGroups.includes(group as AdminManagedGroup))
              .sort(),
          );
        const isSelf = tenantUser.sub === user?.id;
        return {
          draftGroups,
          hasChanges,
          isSelf,
          tenantUser,
        };
      }),
    [drafts, user?.id, users],
  );

  if (!isApiConfigured) {
    return <ErrorState description="Configure the API before using admin tools." title="API not configured" />;
  }

  if (loading) {
    return <LoadingState description="Loading tenant users and current Cognito groups." title="Preparing user groups" />;
  }

  if (error && !users.length) {
    return <ErrorState description={error} title="Unable to load user groups" />;
  }

  return (
    <>
      <ToastStack toasts={toasts} />
      <div className="space-y-4">
        <PageHeader
          description="Assign tenant users to the admin, priest, and servant Cognito groups. Changes are enforced server-side and scoped to your current tenant."
          title="User Groups"
        />

        {error ? <ErrorState description={error} title="Last action failed" /> : null}

        <Card>
          <CardContent className="space-y-3 pt-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">{users.length} tenant users</p>
                <p className="text-xs text-muted-foreground">Admins cannot remove their own last admin role from this screen.</p>
              </div>
              <Button onClick={() => void loadUsers()} type="button" variant="outline">
                Refresh
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Current Groups</TableHead>
                  <TableHead>Manage Roles</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ draftGroups, hasChanges, isSelf, tenantUser }) => (
                  <TableRow key={tenantUser.username}>
                    <TableCell>
                      <div className="font-medium">{tenantUser.name}</div>
                      <div className="text-xs text-muted-foreground">{tenantUser.status ?? "CONFIRMED"}</div>
                    </TableCell>
                    <TableCell>
                      <div>{tenantUser.email}</div>
                      <div className="text-xs text-muted-foreground">{tenantUser.username}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {tenantUser.groups.length ? tenantUser.groups.map((group) => (
                          <Badge key={group} variant={managedGroups.includes(group as AdminManagedGroup) ? "success" : "neutral"}>
                            {formatGroupLabel(group)}
                          </Badge>
                        )) : <span className="text-xs text-muted-foreground">No groups</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-3">
                        {managedGroups.map((group) => {
                          const checked = draftGroups.includes(group);
                          const disabled = savingUsername === tenantUser.username || (isSelf && group === "admin" && checked);
                          return (
                            <label className="flex items-center gap-2 text-sm text-foreground" key={group}>
                              <Checkbox
                                checked={checked}
                                disabled={disabled}
                                onChange={(event) => updateDraft(tenantUser.username, group, event.target.checked)}
                              />
                              <span>{formatGroupLabel(group)}</span>
                            </label>
                          );
                        })}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        disabled={!hasChanges || savingUsername === tenantUser.username}
                        onClick={() => void saveGroups(tenantUser)}
                        type="button"
                        variant={hasChanges ? "default" : "outline"}
                      >
                        <Save className="h-3.5 w-3.5" />
                        {savingUsername === tenantUser.username ? "Saving..." : "Save"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
};
