import { useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useAuth } from "../lib/auth";
import { APP_SHORT_DISPLAY_NAME } from "../lib/app-metadata";

export const AuthPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { status, isConfigured, signInWithPassword, completeNewPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [requiresNewPassword, setRequiresNewPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const redirectTo = useMemo(() => {
    const state = location.state as { from?: { pathname?: string } } | null;
    const nextPath = state?.from?.pathname;

    if (!nextPath || nextPath === "/") {
      return "/members";
    }

    return nextPath;
  }, [location.state]);

  if (status === "authenticated") {
    return <Navigate replace to={redirectTo} />;
  }

  const resetFeedback = () => {
    setMessage("");
    setError("");
  };

  const handleSignIn = async () => {
    resetFeedback();
    setSubmitting(true);

    try {
      const result = await signInWithPassword(email, password);

      if (result.status === "signed-in") {
        navigate(redirectTo, { replace: true });
        return;
      }

      setRequiresNewPassword(true);
      setMessage("This account needs a new password before sign-in can complete.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteNewPassword = async () => {
    resetFeedback();
    setSubmitting(true);

    try {
      await completeNewPassword(newPassword);
      navigate(redirectTo, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to set a new password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-transparent px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl items-center justify-center">
        <Card className="w-full max-w-2xl rounded-lg px-4 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col items-center text-center">
            <img alt="Shepherd Hub logo" className="h-16 w-auto sm:h-20" src="/logo_blue.png" />
            <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{APP_SHORT_DISPLAY_NAME}</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-balance text-slate-900 sm:text-4xl">
              {requiresNewPassword ? "Create your new password" : "Sign in to continue"}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
              {requiresNewPassword
                ? "Complete your first sign-in by choosing a permanent password for your account."
                : "Use your Cognito username and password to access members, schedules, and congregation tools."}
            </p>
          </div>

          <CardContent className="px-0 pb-0">
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();

                if (requiresNewPassword) {
                  void handleCompleteNewPassword();
                  return;
                }

                void handleSignIn();
              }}
            >
              {!isConfigured ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Auth is not configured in `amplify_outputs.json` yet. Provision or regenerate outputs after deploying Amplify.
                </div>
              ) : null}

              <div className="grid gap-1.5">
                <label className="text-sm font-medium text-slate-800">Username</label>
                <Input
                  className="h-10 rounded-md px-3 text-sm"
                  disabled={requiresNewPassword}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Enter your username"
                  type="text"
                  value={email}
                />
              </div>

              {!requiresNewPassword ? (
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium text-slate-800">Password</label>
                  <Input
                    className="h-10 rounded-md px-3 text-sm"
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    type="password"
                    value={password}
                  />
                </div>
              ) : (
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium text-slate-800">New Password</label>
                  <Input
                    className="h-10 rounded-md px-3 text-sm"
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder="Choose a new password"
                    type="password"
                    value={newPassword}
                  />
                </div>
              )}

              {message ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}
              {error ? <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

              <Button className="mt-1 h-10 w-full rounded-md px-4 text-sm font-medium" disabled={submitting || !isConfigured} type="submit">
                {requiresNewPassword ? (submitting ? "Saving..." : "Set New Password") : submitting ? "Signing In..." : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
