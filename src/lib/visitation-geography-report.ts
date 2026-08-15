import { useQuery } from "@tanstack/react-query";

import type { VisitationGeographyReportResponse } from "../../shared/types";
import { api } from "./api";
import { useAuth } from "./auth";

const VISITATION_GEOGRAPHY_REPORT_STALE_TIME = 5 * 60 * 1000;

export type VisitationGeographyReportParams = {
  from?: string;
  to?: string;
  sinceBeginning?: boolean;
  type?: string;
  visitorMode?: string;
  visitorUserId?: string;
};

export const visitationGeographyReportQueryKey = (
  cacheScope: string,
  params: VisitationGeographyReportParams,
) => [
  "visitation-geography-report",
  cacheScope,
  params.from ?? null,
  params.to ?? null,
  params.sinceBeginning ?? false,
  params.type ?? null,
  params.visitorMode ?? null,
  params.visitorUserId ?? null,
] as const;

export const visitationGeographyReportQueryOptions = (
  cacheScope: string,
  enabled: boolean,
  params: VisitationGeographyReportParams,
) => ({
  enabled,
  gcTime: 24 * 60 * 60 * 1000,
  queryFn: async () => {
    const query = new URLSearchParams();

    if (params.from) {
      query.set("from", params.from.slice(0, 10));
    }
    if (params.to) {
      query.set("to", params.to.slice(0, 10));
    }
    if (params.sinceBeginning) {
      query.set("sinceBeginning", "true");
    }
    if (params.type) {
      query.set("type", params.type);
    }
    if (params.visitorMode) {
      query.set("visitorMode", params.visitorMode);
    }
    if (params.visitorUserId) {
      query.set("visitorUserId", params.visitorUserId);
    }

    const suffix = query.size ? `?${query.toString()}` : "";
    return api.get<VisitationGeographyReportResponse>(`/reports/visitation-geography${suffix}`);
  },
  queryKey: visitationGeographyReportQueryKey(cacheScope, params),
  refetchOnMount: "always" as const,
  refetchOnReconnect: "always" as const,
  staleTime: VISITATION_GEOGRAPHY_REPORT_STALE_TIME,
});

export const useVisitationGeographyReport = (params: VisitationGeographyReportParams) => {
  const { user, status } = useAuth();
  const tenantId = user?.tenantId ?? null;
  const cacheScope = tenantId ?? (user?.id ? `user:${user.id}` : "anonymous");

  return useQuery(
    visitationGeographyReportQueryOptions(cacheScope, status === "authenticated", params),
  );
};
