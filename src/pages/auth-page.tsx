import { useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useAuth } from "../lib/auth";

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
      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-lg border border-blue-100/80 bg-gradient-to-br from-slate-950 via-blue-950 to-blue-700 p-5 text-white panel-shadow sm:p-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-blue-200/80">Project Template</p>
          <h1 className="mt-3 max-w-xl text-2xl font-semibold leading-tight sm:text-3xl">
            Secure congregation app with Amplify auth, protected routes, and serverless APIs.
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-blue-100/80">
            Sign in with your Cognito account to access members, calendar settings, and schedule tools.
          </p>
        </div>

        <Card className="self-start">
          <CardHeader className="flex-col gap-3">
            <div>
              <CardTitle>{requiresNewPassword ? "Set New Password" : "Sign In"}</CardTitle>
              <CardDescription>
                {requiresNewPassword
                  ? "Complete your first sign-in by choosing a permanent password."
                  : "Use your Cognito email and password to access the app."}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {!isConfigured ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Auth is not configured in `amplify_outputs.json` yet. Provision or regenerate outputs after deploying Amplify.
              </div>
            ) : null}

            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-slate-800">Email</label>
              <Input
                disabled={requiresNewPassword}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                type="email"
                value={email}
              />
            </div>

            {!requiresNewPassword ? (
              <div className="grid gap-1.5">
                <label className="text-sm font-medium text-slate-800">Password</label>
                <Input
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
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="Choose a new password"
                  type="password"
                  value={newPassword}
                />
              </div>
            )}

            {message ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}
            {error ? <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

            {!requiresNewPassword ? (
              <Button className="min-w-32" disabled={submitting || !isConfigured} onClick={() => void handleSignIn()} type="button">
                {submitting ? "Signing In..." : "Sign In"}
              </Button>
            ) : (
              <Button className="min-w-40" disabled={submitting || !isConfigured} onClick={() => void handleCompleteNewPassword()} type="button">
                {submitting ? "Saving..." : "Set New Password"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
