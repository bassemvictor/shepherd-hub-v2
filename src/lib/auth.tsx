import {
  confirmSignIn,
  fetchAuthSession,
  getCurrentUser,
  signIn,
  signOut,
} from "aws-amplify/auth";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";

import { isAmplifyAuthConfigured } from "./amplify";
import type { AppCognitoGroup } from "../../shared/types";

export type AppAuthUser = {
  id: string;
  username: string;
  email: string;
  name: string;
  tenantId: string | null;
  groups: AppCognitoGroup[];
};

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type SignInResult =
  | { status: "signed-in" }
  | { status: "new-password-required" };

type AuthContextValue = {
  isConfigured: boolean;
  status: AuthStatus;
  user: AppAuthUser | null;
  refreshUser: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<SignInResult>;
  completeNewPassword: (newPassword: string) => Promise<void>;
  signOutUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const ALL_GROUPS: AppCognitoGroup[] = [
  "admin",
  "priest",
  "servant",
];

const isAppGroup = (value: string): value is AppCognitoGroup =>
  ALL_GROUPS.includes(value as AppCognitoGroup);

const normalizeGroupEntries = (rawGroups: unknown): string[] => {
  if (Array.isArray(rawGroups)) {
    return rawGroups.flatMap((group) => normalizeGroupEntries(group));
  }

  if (typeof rawGroups !== "string") {
    return [];
  }

  const trimmed = rawGroups.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? normalizeGroupEntries(parsed) : [];
    } catch {
      const unwrapped = trimmed.slice(1, -1).trim();
      return unwrapped
        .split(/[,\s]+/)
        .map((group) => group.trim().replace(/^['"]|['"]$/g, "").toLowerCase())
        .filter(Boolean);
    }
  }

  return trimmed
    .split(trimmed.includes(",") ? "," : /\s+/)
    .map((group) => group.trim().replace(/^['"]|['"]$/g, "").toLowerCase())
    .filter(Boolean);
};

const normalizeGroups = (rawGroups: unknown): AppCognitoGroup[] => {
  return [...new Set(normalizeGroupEntries(rawGroups).filter(isAppGroup))];
};

export const hasAnyGroup = (groups: readonly AppCognitoGroup[], allowedGroups: readonly AppCognitoGroup[]) =>
  allowedGroups.some((group) => groups.includes(group));

export const canManageAccess = (groups: readonly AppCognitoGroup[]) =>
  hasAnyGroup(groups, ["admin"]);

export const isAdminUser = (groups: readonly AppCognitoGroup[]) =>
  hasAnyGroup(groups, ["admin"]);

const buildUserFromSession = async (): Promise<AppAuthUser | null> => {
  const currentUser = await getCurrentUser();
  const session = await fetchAuthSession();
  const payload = session.tokens?.idToken?.payload ?? {};
  const groups = normalizeGroups(payload["cognito:groups"]);
  const email = typeof payload.email === "string" ? payload.email : currentUser.signInDetails?.loginId ?? currentUser.username;
  const name = typeof payload.name === "string" ? payload.name : email;
  const tenantId =
    typeof payload["custom:tenantId"] === "string" && payload["custom:tenantId"].trim()
      ? payload["custom:tenantId"].trim()
      : typeof payload["custom:tenant_id"] === "string" && payload["custom:tenant_id"].trim()
        ? payload["custom:tenant_id"].trim()
        : null;

  return {
    id: currentUser.userId,
    username: currentUser.username,
    email,
    name,
    tenantId,
    groups,
  };
};

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [status, setStatus] = useState<AuthStatus>(isAmplifyAuthConfigured ? "loading" : "unauthenticated");
  const [user, setUser] = useState<AppAuthUser | null>(null);

  const refreshUser = async () => {
    if (!isAmplifyAuthConfigured) {
      setUser(null);
      setStatus("unauthenticated");
      return;
    }

    try {
      const nextUser = await buildUserFromSession();
      setUser(nextUser);
      setStatus(nextUser ? "authenticated" : "unauthenticated");
    } catch {
      setUser(null);
      setStatus("unauthenticated");
    }
  };

  useEffect(() => {
    void refreshUser();
  }, []);

  const signInWithPassword = async (email: string, password: string) => {
    const result = await signIn({
      username: email,
      password,
    });

    if (result.isSignedIn) {
      await refreshUser();
      return { status: "signed-in" } satisfies SignInResult;
    }

    if (result.nextStep.signInStep === "CONFIRM_SIGN_UP") {
      throw new Error("Confirm your account before signing in.");
    }

    if (result.nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
      return { status: "new-password-required" } satisfies SignInResult;
    }

    throw new Error(`Sign-in step not completed: ${result.nextStep.signInStep}`);
  };

  const completeNewPassword = async (newPassword: string) => {
    const result = await confirmSignIn({
      challengeResponse: newPassword,
    });

    if (!result.isSignedIn) {
      throw new Error("Unable to complete the new password challenge.");
    }

    await refreshUser();
  };

  const signOutUser = async () => {
    await signOut();
    setUser(null);
    setStatus("unauthenticated");
  };

  return (
    <AuthContext.Provider
      value={{
        isConfigured: isAmplifyAuthConfigured,
        status,
        user,
        refreshUser,
        signInWithPassword,
        completeNewPassword,
        signOutUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }

  return value;
};

export const groupLabelMap: Record<string, string> = {
  admin: "Admin",
  priest: "Priest",
  servant: "Servant",
};

export const formatGroupLabel = (group: string) => groupLabelMap[group] ?? group;
