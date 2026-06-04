import type { ReactNode } from "react";

import { Button } from "../ui/button";
import { RightSideDrawer } from "./right-side-drawer";

type FormDrawerProps = {
  open: boolean;
  title: string;
  description?: string;
  submitLabel: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
};

export const FormDrawer = ({
  open,
  title,
  description,
  submitLabel,
  busy = false,
  onClose,
  onSubmit,
  children,
}: FormDrawerProps) => (
  <RightSideDrawer
    description={description}
    footer={
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button onClick={onClose} type="button" variant="outline">
          Cancel
        </Button>
        <Button disabled={busy} onClick={onSubmit} type="button">
          {busy ? "Saving..." : submitLabel}
        </Button>
      </div>
    }
    onClose={onClose}
    open={open}
    title={title}
  >
    {children}
  </RightSideDrawer>
);
