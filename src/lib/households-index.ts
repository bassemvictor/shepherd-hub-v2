import { tagFilterQuery } from "./tags";
import type { TagFilters } from "../../shared/types";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import type { HouseholdDirectoryResponse, HouseholdSummary } from "../../shared/types";
import { useAuth } from "./auth";
import { api } from "./api";

const HOUSEHOLDS_INDEX_STALE_TIME = 10 * 60 * 1000;

export const householdsIndexQueryKey = (cacheScope: string) => ["households-index", cacheScope] as const;

export const householdsIndexQueryOptions = (cacheScope: string, enabled: boolean, filters: TagFilters = {}) => ({
  enabled,
  gcTime: 24 * 60 * 60 * 1000,
  queryFn: async () => {
    const items: HouseholdSummary[] = [];
    let nextCursor: string | undefined;
    let total = 0;

    do {
      const params = tagFilterQuery(filters);
      params.set("limit", "100");
      if (nextCursor) {
        params.set("cursor", nextCursor);
      }

      const response = await api.get<HouseholdDirectoryResponse>(`/households?${params.toString()}`);
      items.push(...response.items);
      nextCursor = response.nextCursor;
      total = response.total;
    } while (nextCursor);

    return {
      items,
      total,
    };
  },
  queryKey: filters.tagIds?.length ? [...householdsIndexQueryKey(cacheScope), tagFilterQuery(filters).toString()] : householdsIndexQueryKey(cacheScope),
  refetchOnMount: "always" as const,
  refetchOnReconnect: "always" as const,
  staleTime: HOUSEHOLDS_INDEX_STALE_TIME,
});

export const refreshHouseholdsIndexCache = async (queryClient: QueryClient, cacheScope: string | null | undefined) => {
  if (!cacheScope) {
    return;
  }

  await Promise.all([queryClient.invalidateQueries({ queryKey: householdsIndexQueryKey(cacheScope) }), queryClient.invalidateQueries({ queryKey: ["tags"] })]);
  await queryClient.fetchQuery(householdsIndexQueryOptions(cacheScope, true));
};

export const useHouseholdsIndex = (filters: TagFilters = {}) => {
  const { user, status } = useAuth();
  const tenantId = user?.tenantId ?? null;
  const cacheScope = tenantId ?? (user?.id ? `user:${user.id}` : "anonymous");
  const queryClient = useQueryClient();
  const query = useQuery(householdsIndexQueryOptions(cacheScope, status === "authenticated", filters));

  return {
    ...query,
    cacheScope,
    items: (query.data?.items ?? []) as HouseholdSummary[],
    refresh: async () => refreshHouseholdsIndexCache(queryClient, cacheScope),
    status,
    tenantId,
    total: query.data?.total ?? 0,
  };
};
