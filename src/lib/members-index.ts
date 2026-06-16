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

export const membersIndexQueryKey = (tenantId: string) => ["members-index", tenantId] as const;

export const membersIndexQueryOptions = (tenantId: string) => ({
  enabled: Boolean(tenantId),
  gcTime: 24 * 60 * 60 * 1000,
  queryFn: () => api.get<MemberIndexResponse>("/members/index"),
  queryKey: membersIndexQueryKey(tenantId),
  refetchOnMount: "always" as const,
  refetchOnReconnect: "always" as const,
  staleTime: MEMBERS_INDEX_STALE_TIME,
});

export const toCachedMemberIndexItem = (member: Pick<
  Member,
  "memberId" | "fullName" | "initials" | "phone" | "email" | "householdName" | "unityId" | "source" | "normalizedSearchText" | "updatedAt"
>): MemberIndexItem => ({
  memberId: member.memberId,
  fullName: member.fullName,
  initials: member.initials,
  phone: member.phone,
  email: member.email,
  householdName: member.householdName,
  unityId: member.unityId,
  isUnityImported: member.source === "UNITY",
  source: member.source,
  normalizedSearchText: member.normalizedSearchText,
  updatedAt: member.updatedAt,
});

export const refreshMembersIndexCache = async (queryClient: QueryClient, tenantId: string | null | undefined) => {
  if (!tenantId) {
    return;
  }

  await queryClient.invalidateQueries({ queryKey: membersIndexQueryKey(tenantId) });
  await queryClient.fetchQuery(membersIndexQueryOptions(tenantId));
};

export const removeMemberFromMembersIndexCache = (
  queryClient: QueryClient,
  tenantId: string | null | undefined,
  memberId: string,
) => {
  if (!tenantId) {
    return;
  }

  queryClient.setQueryData<MemberIndexResponse | undefined>(
    membersIndexQueryKey(tenantId),
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
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? "";
  const queryClient = useQueryClient();
  const query = useQuery(membersIndexQueryOptions(tenantId));

  return {
    ...query,
    items: query.data?.items ?? [],
    refresh: async () => refreshMembersIndexCache(queryClient, tenantId),
    tenantId,
  };
};
