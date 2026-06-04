import type { ReactNode } from "react";

import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
};

export const ConfirmDialog = ({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
  children,
}: ConfirmDialogProps) => (
  <Dialog description={description} onClose={onClose} open={open} title={title}>
    <div className="space-y-5">
      {children}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button onClick={onClose} type="button" variant="outline">
          {cancelLabel}
        </Button>
        <Button
          className={destructive ? "bg-rose-600 hover:bg-rose-700" : undefined}
          disabled={busy}
          onClick={onConfirm}
          type="button"
        >
          {busy ? "Working..." : confirmLabel}
        </Button>
      </div>
    </div>
  </Dialog>
);
