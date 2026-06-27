import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

type HistoryStateWithIndex = {
  idx?: number;
  overlayStack?: string[];
} & Record<string, unknown>;

const DEFAULT_ROUTE = "/members";

const getHistoryState = () => (window.history.state ?? {}) as HistoryStateWithIndex;

export const AndroidBackButtonHandler = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const handleBackButton = () => {
      const historyState = getHistoryState();

      if (Array.isArray(historyState.overlayStack) && historyState.overlayStack.length > 0) {
        window.history.back();
        return;
      }

      if (typeof historyState.idx === "number" && historyState.idx > 0) {
        window.history.back();
        return;
      }

      if (window.history.length > 1 && location.pathname !== DEFAULT_ROUTE) {
        window.history.back();
        return;
      }

      if (location.pathname !== DEFAULT_ROUTE) {
        navigate(DEFAULT_ROUTE, { replace: true });
      }
    };

    document.addEventListener("backbutton", handleBackButton);

    return () => {
      document.removeEventListener("backbutton", handleBackButton);
    };
  }, [location.pathname, navigate]);

  return null;
};
