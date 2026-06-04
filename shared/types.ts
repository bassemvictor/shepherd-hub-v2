export type EntityEnvelope = {
  entityType: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
};

export type AppCognitoGroup =
  | "sales_engineer"
  | "sales_manager"
  | "pricing_engineer"
  | "admin"
  | "super_user";

export type RecordStatus = "draft" | "active" | "archived";

export type SampleRecord = EntityEnvelope & {
  recordId: string;
  name: string;
  status: RecordStatus;
  owner: string;
};

export type SampleRecordInput = {
  name: string;
  status: RecordStatus;
  owner: string;
};

export type SampleRecordListResponse = {
  items: SampleRecord[];
};

export type DashboardSummary = {
  tenantId: string;
  totalRecords: number;
  activeRecords: number;
  draftRecords: number;
  archivedRecords: number;
};
