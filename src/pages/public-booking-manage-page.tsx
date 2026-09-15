import { DateTime } from "luxon";
import { useCallback, useEffect, useState } from "react";

import type { PublicBookingManagement } from "../../shared/types";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { api, getDisplayErrorMessage, isApiConfigured } from "../lib/api";

export const PublicBookingManagePage = () => {
  const [token] = useState(() => window.location.hash.startsWith("#token=") ? decodeURIComponent(window.location.hash.slice(7)) : "");
  const [booking, setBooking] = useState<PublicBookingManagement | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState(""); const [duration, setDuration] = useState("");
  const load = useCallback(async () => {
    if (!token) { setError("This management link is invalid."); setLoading(false); return; }
    setLoading(true); setError(null);
    try { const next = await api.post<PublicBookingManagement>("/public/bookings/manage", { token }); setBooking(next); setDuration(String(next.durationMinutes)); setStart(DateTime.fromISO(next.start, { zone: "utc" }).setZone(next.timezone).toFormat("yyyy-MM-dd'T'HH:mm")); }
    catch (reason) { setError(getDisplayErrorMessage(reason, "This management link is unavailable.")); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  const cancel = async () => { setBusy(true); setError(null); try { setBooking(await api.post<PublicBookingManagement>("/public/bookings/cancel", { token })); } catch (reason) { setError(getDisplayErrorMessage(reason, "Unable to cancel this appointment.")); } finally { setBusy(false); } };
  const reschedule = async (event: React.FormEvent) => { event.preventDefault(); if (!booking) return; setBusy(true); setError(null); try { const value = DateTime.fromFormat(start, "yyyy-MM-dd'T'HH:mm", { zone: booking.timezone }).toUTC().toISO(); if (!value) throw new Error("Choose a valid date and time."); setBooking(await api.post<PublicBookingManagement>("/public/bookings/reschedule", { token, start: value, durationMinutes: Number(duration) })); } catch (reason) { setError(getDisplayErrorMessage(reason, "Unable to reschedule this appointment.")); } finally { setBusy(false); } };
  if (!isApiConfigured) return <Frame><Message title="Management unavailable" description="This booking page is not configured." /></Frame>;
  if (loading) return <Frame><Message title="Loading appointment" description="Please wait a moment." /></Frame>;
  if (!booking) return <Frame><Message title="Appointment not found" description={error ?? "This management link is unavailable."} /></Frame>;
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short", timeZone: booking.timezone });
  return <Frame><div className="space-y-4"><header><p className="text-sm font-semibold text-primary">MANAGE APPOINTMENT</p><h1 className="text-2xl font-semibold">{booking.priestDisplayName}</h1></header>{error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}<Card><CardHeader><div><CardTitle>{booking.appointmentTypeName}</CardTitle><CardDescription>{booking.status}</CardDescription></div></CardHeader><CardContent className="space-y-1 text-sm"><p>{formatter.format(new Date(booking.start))}</p><p>{booking.durationMinutes} minutes · {booking.timezone}</p>{booking.publicLocation ? <p>{booking.publicLocation}</p> : null}</CardContent></Card>{booking.status === "CONFIRMED" ? <><Card><CardHeader><div><CardTitle>Reschedule</CardTitle><CardDescription>Choose a new valid date, time, and allowed duration. Availability is rechecked before any change.</CardDescription></div></CardHeader><CardContent><form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void reschedule(event)}><label className="space-y-1"><span className="text-sm font-medium">Date and time</span><Input required type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} /></label><label className="space-y-1"><span className="text-sm font-medium">Duration</span><Select value={duration} onChange={(event) => setDuration(event.target.value)}>{booking.allowedDurationsMinutes.map((value) => <option key={value} value={value}>{value} minutes</option>)}</Select></label><Button disabled={busy} type="submit">{busy ? "Updating…" : "Reschedule appointment"}</Button></form></CardContent></Card><Button disabled={busy} onClick={() => void cancel()} type="button" variant="outline">Cancel appointment</Button></> : <p className="rounded-md bg-slate-100 p-3 text-sm">This appointment is cancelled.</p>}</div></Frame>;
};

const Frame = ({ children }: { children: React.ReactNode }) => <main className="min-h-screen bg-slate-50 px-4 py-8 sm:py-14"><div className="mx-auto max-w-2xl rounded-lg border border-border/80 bg-card p-5 shadow-sm sm:p-8">{children}</div></main>;
const Message = ({ title, description }: { title: string; description: string }) => <div className="py-12 text-center"><h1 className="text-xl font-semibold">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{description}</p></div>;
