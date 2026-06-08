import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../../lib/auth";
import { LoadingState } from "../states/loading-state";

export const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const { status, isConfigured } = useAuth();
  const location = useLocation();

  if (!isConfigured) {
    return <Navigate replace to="/auth" state={{ from: location }} />;
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-md">
          <LoadingState
            description="Preparing your app."
            title="Checking your session"
          />
        </div>
      </div>
    );
  }

  if (status !== "authenticated") {
    return <Navigate replace to="/auth" state={{ from: location }} />;
  }

  return children;
};
