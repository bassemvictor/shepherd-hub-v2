import { useQuery } from "@tanstack/react-query";
import type { Tag, TagFilters } from "../../shared/types";
import { api } from "./api";
import { useAuth } from "./auth";

export const tagFilterQuery = (filters: TagFilters = {}) => {
  const params = new URLSearchParams();
  if (filters.tagIds?.length) {
    params.set("tagIds", filters.tagIds.join(","));
    params.set("tagMatchMode", filters.tagMatchMode ?? "any");
  }
  return params;
};
export const useTags = () => {
  const { user, status } = useAuth();
  return useQuery({
    queryKey: ["tags", user?.tenantId ?? user?.id],
    queryFn: () => api.get<{ items: Tag[] }>("/tags?includeInactive=true"),
    enabled: status === "authenticated",
    staleTime: 60_000,
  });
};
