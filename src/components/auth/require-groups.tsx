import { Navigate, useLocation } from "react-router-dom";

import type { AppCognitoGroup } from "../../../shared/types";
import { hasAnyGroup, useAuth } from "../../lib/auth";

type RequireGroupsProps = {
  children: JSX.Element;
  groups: AppCognitoGroup[];
};

export const RequireGroups = ({ children, groups }: RequireGroupsProps) => {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return null;
  }

  if (!user || !hasAnyGroup(user.groups, groups)) {
    return <Navigate replace to="/dashboard" state={{ from: location }} />;
  }

  return children;
};
