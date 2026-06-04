import type { ReactNode } from "react";

import { EmptyState } from "../states/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export type DataGridColumn<T> = {
  key: string;
  header: string;
  className?: string;
  cell: (row: T) => ReactNode;
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
  );
};
