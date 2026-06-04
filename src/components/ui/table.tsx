import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

import { cn } from "../../lib/utils";

type TableProps = TableHTMLAttributes<HTMLTableElement> & {
  framed?: boolean;
};

export const Table = ({ className, framed = true, ...props }: TableProps) => (
  <div className="-mx-4 overflow-x-auto overscroll-x-contain px-4 [-webkit-overflow-scrolling:touch] sm:mx-0 sm:px-0">
    <div
      className={cn(
        "inline-block min-w-full align-top",
        framed && "overflow-hidden rounded-[1.15rem] border border-border/70 bg-white shadow-sm",
      )}
    >
      <table
        className={cn("w-full min-w-[560px] border-separate border-spacing-0 sm:min-w-[640px]", className)}
        {...props}
      />
    </div>
  </div>
);

export const TableHeader = ({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) => (
  <thead
    className={cn("[&_tr]:bg-slate-100/80 [&_th]:border-b [&_th]:border-border/70", className)}
    {...props}
  />
);

export const TableBody = ({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody
    className={cn("[&_tr:not(:last-child)_td]:border-b [&_tr:not(:last-child)_td]:border-border/70", className)}
    {...props}
  />
);

export const TableRow = ({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn(className)} {...props} />
);

export const TableHead = ({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn("px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 sm:px-4", className)}
    {...props}
  />
);

export const TableCell = ({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("px-3 py-4 align-top text-sm text-slate-700 sm:px-4", className)} {...props} />
);
