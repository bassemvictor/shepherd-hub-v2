import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { outreachActivityTypes, type OutreachActivityReportResponse } from "../../shared/types";
import { PageHeader } from "../components/common/page-header";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { api } from "../lib/api";
import { useOutreachGroups, useOutreachServants } from "../lib/outreach";

export const OutreachReportPage = () => {
  const [filters, setFilters] = useState({ fromDate: "", toDate: "", groupId: "", servantId: "", activityType: "" });
  const groups = useOutreachGroups();
  const servants = useOutreachServants();
  const report = useQuery({ queryKey: ["outreach-report", filters], queryFn: () => { const p = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => { if (value) p.set(key, value); }); return api.get<OutreachActivityReportResponse>(`/reports/outreach${p.size ? `?${p}` : ""}`); } });
  const set = (key: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  return <div className="space-y-4"><PageHeader title="Outreach Activity" description="Household Outreach activity by group and servant." /><Card><CardContent className="grid gap-2 pt-4 sm:grid-cols-2 lg:grid-cols-5"><Input aria-label="From date" type="date" value={filters.fromDate} onChange={(e) => set("fromDate", e.target.value)} /><Input aria-label="To date" type="date" value={filters.toDate} onChange={(e) => set("toDate", e.target.value)} /><Select aria-label="Filter Outreach group" value={filters.groupId} onChange={(e) => set("groupId", e.target.value)}><option value="">All groups</option>{groups.data?.items.map((g) => <option key={g.groupId} value={g.groupId}>{g.name}</option>)}</Select><Select aria-label="Filter activity type" value={filters.activityType} onChange={(e) => set("activityType", e.target.value)}><option value="">All activities</option>{outreachActivityTypes.map((type) => <option key={type}>{type}</option>)}</Select>{servants.data?.items?.length ? <Select aria-label="Filter servant" value={filters.servantId} onChange={(e) => set("servantId", e.target.value)}><option value="">All servants</option>{servants.data.items.map((s) => <option key={s.sub} value={s.sub}>{s.name}</option>)}</Select> : <div />}</CardContent></Card>{report.data ? <div className="grid gap-3 sm:grid-cols-3">{[["Activities", report.data.summary.totalActivities], ["Households Contacted", report.data.summary.uniqueHouseholds], ["Active Servants", report.data.summary.uniqueServants]].map(([label, value]) => <Card key={String(label)}><CardContent className="p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></CardContent></Card>)}</div> : null}<Card><CardContent className="p-0">{report.isPending ? <p className="p-4 text-sm text-muted-foreground">Loading Outreach activity…</p> : report.error ? <p className="p-4 text-sm text-rose-700">Unable to load report.</p> : <div className="divide-y">{report.data?.items.map((item) => <div className="grid gap-1 p-4 text-sm md:grid-cols-[120px_150px_1fr_140px_2fr]"><span>{new Date(item.activityDate).toLocaleDateString()}</span><span>{item.groupName}</span><Link className="font-medium text-primary" to={`/households/${item.householdId}`}>{item.householdName}</Link><span>{item.activityType} · {item.createdByName}</span><span className="truncate" title={item.comment}>{item.comment}</span></div>) || <p className="p-4 text-sm text-muted-foreground">No activities found.</p>}</div>}</CardContent></Card></div>;
};
