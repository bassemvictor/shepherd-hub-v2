import { useCallback, useEffect, useRef } from "react";

type HistoryStateWithOverlays = {
  overlayStack?: string[];
} & Record<string, unknown>;

let overlaySequence = 0;

const getOverlayStack = () => {
  if (typeof window === "undefined") {
    return [];
  }

  const state = (window.history.state ?? {}) as HistoryStateWithOverlays;
  return Array.isArray(state.overlayStack) ? state.overlayStack : [];
};

const withOverlayStack = (overlayStack: string[]) => {
  if (typeof window === "undefined") {
    return {};
  }

  const currentState = (window.history.state ?? {}) as HistoryStateWithOverlays;
  return {
    ...currentState,
    overlayStack,
  };
};

export const useOverlayHistory = (open: boolean, onClose: () => void) => {
  const overlayIdRef = useRef(`overlay-${overlaySequence += 1}`);
  const activeRef = useRef(false);

  useEffect(() => {
    if (!open || typeof window === "undefined" || activeRef.current) {
      return;
    }

    const overlayId = overlayIdRef.current;
    const nextStack = [...getOverlayStack(), overlayId];

    window.history.pushState(withOverlayStack(nextStack), "", window.location.href);
    activeRef.current = true;
  }, [open]);

  useEffect(() => {
    if (open || typeof window === "undefined" || !activeRef.current) {
      return;
    }

    const overlayId = overlayIdRef.current;
    const currentStack = getOverlayStack();

    activeRef.current = false;
    if (currentStack.includes(overlayId)) {
      window.history.back();
    }
  }, [open]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handlePopState = () => {
      if (!activeRef.current) {
        return;
      }

      const overlayId = overlayIdRef.current;
      const currentStack = getOverlayStack();
      if (currentStack.includes(overlayId)) {
        return;
      }

      activeRef.current = false;
      onClose();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [onClose]);

  return useCallback(() => {
    if (typeof window !== "undefined" && activeRef.current) {
      window.history.back();
      return;
    }

    onClose();
  }, [onClose]);
};
