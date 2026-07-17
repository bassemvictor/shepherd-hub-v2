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

export const membersIndexQueryOptions = (cacheScope: string, enabled: boolean) => ({
  enabled,
  gcTime: 24 * 60 * 60 * 1000,
  queryFn: () => api.get<MemberIndexResponse>("/members/index"),
  queryKey: membersIndexQueryKey(cacheScope),
  refetchOnMount: "always" as const,
  refetchOnReconnect: "always" as const,
  staleTime: MEMBERS_INDEX_STALE_TIME,
});

export const toCachedMemberIndexItem = (member: Pick<
  Member,
  "memberId" | "fullName" | "initials" | "phone" | "email" | "householdId" | "householdName" | "unityId" | "source" | "normalizedSearchText" | "updatedAt"
>): MemberIndexItem => ({
  memberId: member.memberId,
  fullName: member.fullName,
  initials: member.initials,
  phone: member.phone,
  email: member.email,
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

  await queryClient.invalidateQueries({ queryKey: membersIndexQueryKey(cacheScope) });
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

  queryClient.setQueryData<MemberIndexResponse | undefined>(
    membersIndexQueryKey(cacheScope),
    (current) =>
      current
        ? {
            ...current,
            items: current.items.filter((item) => item.memberId !== memberId),
          }
        : current,
  );
};

export const useMembersIndex = () => {
  const { user, status } = useAuth();
  const tenantId = user?.tenantId ?? null;
  const cacheScope = tenantId ?? (user?.id ? `user:${user.id}` : "anonymous");
  const queryClient = useQueryClient();
  const query = useQuery(membersIndexQueryOptions(cacheScope, status === "authenticated"));

  return {
    ...query,
    cacheScope,
    items: query.data?.items ?? [],
    refresh: async () => refreshMembersIndexCache(queryClient, cacheScope),
    status,
    tenantId,
  };
};
