import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  CreateOutreachActivityInput,
  CreateOutreachGroupInput,
  OutreachGroup,
  OutreachGroupHouseholdAssignment,
  OutreachGroupServantAssignment,
  OutreachGroupSummary,
  TenantUserSummary,
  UpdateOutreachGroupInput,
} from "../../shared/types";
import { api } from "./api";
import { useAuth } from "./auth";

export const outreachGroupsKey = ["outreach-groups"] as const;
export const outreachHouseholdsKey = (groupId: string) =>
  ["outreach-group-households", groupId] as const;
export const outreachServantsKey = (groupId: string) =>
  ["outreach-group-servants", groupId] as const;
export const outreachHouseholdGroupsKey = (householdId: string) =>
  ["outreach-household-groups", householdId] as const;

// Kept separate from the page so assignment interactions remain immutable and
// a household or servant can independently occur in more than one group.
export const toggleOutreachAssignment = (ids: readonly string[], id: string) =>
  ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];

export const outreachApi = {
  listGroups: () =>
    api.get<{ items: OutreachGroupSummary[] }>("/outreach/groups"),
  listGroupHouseholds: (groupId: string) =>
    api.get<{ items: OutreachGroupHouseholdAssignment[] }>(
      `/outreach/groups/${encodeURIComponent(groupId)}/households`,
    ),
  listGroupServants: (groupId: string) =>
    api.get<{ items: OutreachGroupServantAssignment[] }>(
      `/outreach/groups/${encodeURIComponent(groupId)}/servants`,
    ),
  listHouseholdGroups: (householdId: string) =>
    api.get<{ items: OutreachGroupSummary[] }>(
      `/outreach/households/${encodeURIComponent(householdId)}/groups`,
    ),
  listServants: () =>
    api.get<{ items: TenantUserSummary[] }>("/outreach/servants"),
  createGroup: (input: CreateOutreachGroupInput) =>
    api.post<OutreachGroup>("/outreach/groups", input),
  updateGroup: (groupId: string, input: UpdateOutreachGroupInput) =>
    api.put<OutreachGroup>(
      `/outreach/groups/${encodeURIComponent(groupId)}`,
      input,
    ),
  deleteGroup: (groupId: string) =>
    api.delete(`/outreach/groups/${encodeURIComponent(groupId)}`),
  replaceHouseholds: (groupId: string, householdIds: string[]) =>
    api.put(`/outreach/groups/${encodeURIComponent(groupId)}/households`, {
      householdIds,
    }),
  replaceServants: (groupId: string, servantIds: string[]) =>
    api.put(`/outreach/groups/${encodeURIComponent(groupId)}/servants`, {
      servantIds,
    }),
  createActivity: (householdId: string, input: CreateOutreachActivityInput) =>
    api.post(
      `/outreach/households/${encodeURIComponent(householdId)}/activities`,
      input,
    ),
};

const useOutreachCacheScope = () => {
  const { user } = useAuth();
  return user
    ? `tenant:${user.tenantId ?? "unknown"}:user:${user.id}:groups:${[...user.groups].sort().join(",")}`
    : "anonymous";
};

export const useOutreachGroups = () => {
  const scope = useOutreachCacheScope();
  return useQuery({
    queryKey: [...outreachGroupsKey, scope],
    queryFn: outreachApi.listGroups,
  });
};

export const useOutreachGroupHouseholds = (groupId: string | null) => {
  const scope = useOutreachCacheScope();
  return useQuery({
    enabled: Boolean(groupId),
    queryKey: [...outreachHouseholdsKey(groupId ?? "none"), scope],
    queryFn: () => outreachApi.listGroupHouseholds(groupId ?? ""),
  });
};

export const useOutreachHouseholdsForGroups = (groupIds: readonly string[]) => {
  const scope = useOutreachCacheScope();
  return useQueries({
    queries: groupIds.map((groupId) => ({
      queryKey: [...outreachHouseholdsKey(groupId), scope],
      queryFn: () => outreachApi.listGroupHouseholds(groupId),
    })),
  });
};

export const useOutreachGroupServants = (groupId: string | null) => {
  const scope = useOutreachCacheScope();
  return useQuery({
    enabled: Boolean(groupId),
    queryKey: [...outreachServantsKey(groupId ?? "none"), scope],
    queryFn: () => outreachApi.listGroupServants(groupId ?? ""),
  });
};

export const useOutreachHouseholdGroups = (householdId: string | null) => {
  const scope = useOutreachCacheScope();
  return useQuery({
    enabled: Boolean(householdId),
    queryKey: [...outreachHouseholdGroupsKey(householdId ?? "none"), scope],
    queryFn: () => outreachApi.listHouseholdGroups(householdId ?? ""),
  });
};

export const useOutreachServants = () => {
  const scope = useOutreachCacheScope();
  return useQuery({
    queryKey: ["outreach-servants", scope],
    queryFn: outreachApi.listServants,
  });
};

export const useOutreachActions = () => {
  const client = useQueryClient();
  const refresh = async (groupId?: string) => {
    await client.invalidateQueries({ queryKey: outreachGroupsKey });
    if (groupId)
      await Promise.all([
        client.invalidateQueries({ queryKey: outreachHouseholdsKey(groupId) }),
        client.invalidateQueries({ queryKey: outreachServantsKey(groupId) }),
      ]);
  };
  const refreshHouseholdAssignmentCaches = async (householdId: string) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: outreachGroupsKey }),
      client.invalidateQueries({ queryKey: ["outreach-group-households"] }),
      client.invalidateQueries({
        queryKey: outreachHouseholdGroupsKey(householdId),
      }),
      client.invalidateQueries({ queryKey: ["households-index"] }),
      client.invalidateQueries({ queryKey: ["members-index"] }),
    ]);
  };
  return {
    create: async (input: CreateOutreachGroupInput) => {
      const group = await outreachApi.createGroup(input);
      await refresh();
      return group;
    },
    update: async (groupId: string, input: UpdateOutreachGroupInput) => {
      const group = await outreachApi.updateGroup(groupId, input);
      await refresh(groupId);
      return group;
    },
    remove: async (groupId: string) => {
      await outreachApi.deleteGroup(groupId);
      await refresh(groupId);
    },
    replaceHouseholds: async (groupId: string, householdIds: string[]) => {
      await outreachApi.replaceHouseholds(groupId, householdIds);
      await refresh(groupId);
    },
    replaceServants: async (groupId: string, servantIds: string[]) => {
      await outreachApi.replaceServants(groupId, servantIds);
      await refresh(groupId);
    },
    replaceHouseholdGroups: async (
      householdId: string,
      currentGroupIds: string[],
      nextGroupIds: string[],
    ) => {
      const changedGroupIds = [
        ...new Set([...currentGroupIds, ...nextGroupIds]),
      ];
      const next = new Set(nextGroupIds);
      await Promise.all(
        changedGroupIds.map(async (groupId) => {
          const assignments = await outreachApi.listGroupHouseholds(groupId);
          const ids = assignments.items.map((item) => item.householdId);
          const hasHousehold = ids.includes(householdId);
          if (next.has(groupId) === hasHousehold) return;
          await outreachApi.replaceHouseholds(
            groupId,
            next.has(groupId)
              ? [...ids, householdId]
              : ids.filter((id) => id !== householdId),
          );
        }),
      );
      await refreshHouseholdAssignmentCaches(householdId);
    },
  };
};
