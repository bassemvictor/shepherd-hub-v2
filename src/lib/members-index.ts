import { tagFilterQuery } from "./tags";
import type { TagFilters } from "../../shared/types";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import type {
  Member,
  MemberIndexItem,
  MemberIndexResponse,
} from "../../shared/types";
import { useAuth } from "./auth";
import { api } from "./api";

const MEMBERS_INDEX_STALE_TIME = 20 * 60 * 1000;

export const membersIndexQueryKey = (cacheScope: string) => ["members-index", cacheScope] as const;

export const membersIndexQueryOptions = (cacheScope: string, enabled: boolean, filters: TagFilters = {}) => ({
  enabled,
  gcTime: 24 * 60 * 60 * 1000,
  queryFn: () => api.get<MemberIndexResponse>(`/members/index?${tagFilterQuery(filters)}`),
  queryKey: filters.tagIds?.length ? [...membersIndexQueryKey(cacheScope), tagFilterQuery(filters).toString()] : membersIndexQueryKey(cacheScope),
  refetchOnMount: "always" as const,
  refetchOnReconnect: "always" as const,
  staleTime: MEMBERS_INDEX_STALE_TIME,
});

export const toCachedMemberIndexItem = (member: Pick<
  Member,
  "tagIds" | "memberId" | "fullName" | "initials" | "phone" | "email" | "address" | "postalCode" | "householdId" | "householdName" | "unityId" | "source" | "normalizedSearchText" | "updatedAt"
>): MemberIndexItem => ({
  tagIds: member.tagIds,
  memberId: member.memberId,
  fullName: member.fullName,
  initials: member.initials,
  phone: member.phone,
  email: member.email,
  address: member.address,
  postalCode: member.postalCode,
  householdId: member.householdId,
  householdName: member.householdName,
  unityId: member.unityId,
  isUnityImported: member.source === "UNITY",
  source: member.source,
  normalizedSearchText: member.normalizedSearchText,
  updatedAt: member.updatedAt,
});

export const refreshMembersIndexCache = async (queryClient: QueryClient, cacheScope: string | null | undefined) => {
  if (!cacheScope) {
    return;
  }

  await Promise.all([queryClient.invalidateQueries({ queryKey: membersIndexQueryKey(cacheScope) }), queryClient.invalidateQueries({ queryKey: ["tags"] })]);
  await queryClient.fetchQuery(membersIndexQueryOptions(cacheScope, true));
};

export const removeMemberFromMembersIndexCache = (
  queryClient: QueryClient,
  cacheScope: string | null | undefined,
  memberId: string,
) => {
  if (!cacheScope) {
    return;
  }

  queryClient.setQueriesData<MemberIndexResponse | undefined>(
    { queryKey: membersIndexQueryKey(cacheScope) },
    (current) =>
      current
        ? {
            ...current,
            items: current.items.filter((item) => item.memberId !== memberId),
          }
        : current,
  );
};

export const useMembersIndex = (filters: TagFilters = {}) => {
  const { user, status } = useAuth();
  const tenantId = user?.tenantId ?? null;
  const cacheScope = tenantId ?? (user?.id ? `user:${user.id}` : "anonymous");
  const queryClient = useQueryClient();
  const query = useQuery(membersIndexQueryOptions(cacheScope, status === "authenticated", filters));

  return {
    ...query,
    cacheScope,
    items: query.data?.items ?? [],
    refresh: async () => refreshMembersIndexCache(queryClient, cacheScope),
    status,
    tenantId,
  };
};
