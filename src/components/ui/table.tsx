import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

import { cn } from "../../lib/utils";

type TableProps = TableHTMLAttributes<HTMLTableElement> & {
  framed?: boolean;
};

export const Table = ({ className, framed = true, ...props }: TableProps) => (
  <div className="-mx-2 overflow-x-auto overscroll-x-contain px-2 [-webkit-overflow-scrolling:touch] sm:mx-0 sm:px-0">
    <div
      className={cn(
        "inline-block min-w-full align-top",
        framed && "overflow-hidden rounded-md border border-border/70 bg-card shadow-sm",
      )}
    >
      <table
        className={cn("w-full min-w-[520px] border-separate border-spacing-0 sm:min-w-[640px]", className)}
        {...props}
      />
    </div>
  </div>
);

export const TableHeader = ({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) => (
  <thead
    className={cn("sticky top-0 z-[1] bg-card [&_tr]:bg-muted/70 [&_th]:border-b [&_th]:border-border/70", className)}
    {...props}
  />
);

export const TableBody = ({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody
    className={cn(
      "[&_tr:nth-child(even)]:bg-muted/25 [&_tr:not(:last-child)_td]:border-b [&_tr:not(:last-child)_td]:border-border/70",
      className,
    )}
    {...props}
  />
);

export const TableRow = ({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn(className)} {...props} />
);

export const TableHead = ({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn("px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground sm:px-3", className)}
    {...props}
  />
);

export const TableCell = ({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("px-2 py-2.5 align-top text-sm text-foreground sm:px-3", className)} {...props} />
);
