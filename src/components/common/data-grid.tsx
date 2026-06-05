import type { ReactNode } from "react";

import { EmptyState } from "../states/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export type DataGridColumn<T> = {
  key: string;
  header: string;
  className?: string;
  cell: (row: T) => ReactNode;
  mobileVariant?: "default" | "actions";
};

type DataGridProps<T> = {
  columns: DataGridColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  emptyTitle: string;
  emptyDescription: string;
};

export const DataGrid = <T,>({
  columns,
  rows,
  getRowKey,
  emptyTitle,
  emptyDescription,
}: DataGridProps<T>) => {
  if (!rows.length) {
    return <EmptyState description={emptyDescription} title={emptyTitle} />;
  }

  return (
    <>
      <div className="grid gap-2 md:hidden">
        {rows.map((row) => {
          const defaultColumns = columns.filter((column) => column.mobileVariant !== "actions");
          const actionColumns = columns.filter((column) => column.mobileVariant === "actions");

          return (
            <div className="rounded-md border border-border/70 bg-white p-3 shadow-sm" key={getRowKey(row)}>
              <div className="space-y-2">
                {defaultColumns.map((column, index) => (
                  <div
                    className={index === 0 ? "space-y-1" : "grid gap-1"}
                    key={column.key}
                  >
                    {index === 0 ? null : (
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        {column.header}
                      </span>
                    )}
                    <div className="text-sm text-slate-700">{column.cell(row)}</div>
                  </div>
                ))}
                {actionColumns.length ? (
                  <div className="border-t border-border/70 pt-2">
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Actions
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {actionColumns.map((column) => (
                        <div key={column.key}>{column.cell(row)}</div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead className={column.className} key={column.key}>
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow className="bg-white" key={getRowKey(row)}>
                {columns.map((column) => (
                  <TableCell className={column.className} key={column.key}>
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
};
