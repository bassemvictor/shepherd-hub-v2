import { CalendarDays, MapPin } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import type { PublicBookingPage as PublicBookingPageDto } from "../../shared/types";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { api, getDisplayErrorMessage, isApiConfigured } from "../lib/api";

type BookingSelection = {
  appointmentTypeId: string | null;
  selectedDate: string | null;
  durationMinutes: number | null;
  selectedStart: string | null;
};

const durationLabel = (durations: number[]) => durations.map((duration) => `${duration} min`).join(" / ");

export const PublicBookingPage = () => {
  const { slug = "" } = useParams();
  const [page, setPage] = useState<PublicBookingPageDto | null>(null);
  const [selection, setSelection] = useState<BookingSelection>({ appointmentTypeId: null, selectedDate: null, durationMinutes: null, selectedStart: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setPage(await api.get<PublicBookingPageDto>(`/public/booking-pages/${encodeURIComponent(slug)}`)); }
    catch (reason) { setError(getDisplayErrorMessage(reason, "This booking page is unavailable.")); }
    finally { setLoading(false); }
  }, [slug]);
  useEffect(() => { void load(); }, [load]);

  if (!isApiConfigured) return <PublicFrame><PublicMessage title="Booking page unavailable" description="This booking page has not been configured yet." /></PublicFrame>;
  if (loading) return <PublicFrame><PublicMessage title="Loading booking page" description="Please wait a moment." /></PublicFrame>;
  if (!page) return <PublicFrame><PublicMessage title="Booking page not found" description={error ?? "This booking page is unavailable."} /></PublicFrame>;
  const selected = page.appointmentTypes.find((type) => type.id === selection.appointmentTypeId);

  return <PublicFrame><div className="space-y-5">
    <header className="space-y-2"><div className="flex items-center gap-2 text-primary"><CalendarDays className="h-5 w-5" /><span className="text-sm font-semibold tracking-wide">BOOK AN APPOINTMENT</span></div><h1 className="text-3xl font-semibold tracking-tight text-foreground">{page.displayName}</h1>{page.introduction ? <p className="max-w-2xl text-base text-muted-foreground">{page.introduction}</p> : null}</header>
    {!selected ? <section className="space-y-3"><div><h2 className="text-lg font-semibold">Choose appointment type</h2><p className="text-sm text-muted-foreground">Select the kind of appointment you need. You will choose a date next.</p></div><div className="grid gap-3 md:grid-cols-2">{page.appointmentTypes.map((type) => <button className="rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/30" key={type.id} onClick={() => setSelection({ appointmentTypeId: type.id, selectedDate: null, durationMinutes: null, selectedStart: null })} type="button"><Card className="h-full transition hover:border-primary/50 hover:bg-accent/30"><CardHeader><CardTitle>{type.name}</CardTitle>{type.publicLocation ? <CardDescription className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{type.publicLocation}</CardDescription> : null}</CardHeader><CardContent>{type.description ? <p className="mb-3 text-sm text-muted-foreground">{type.description}</p> : null}<p className="text-sm font-medium text-foreground">{durationLabel(type.allowedDurationsMinutes)}</p><p className="mt-1 text-xs text-muted-foreground">Default duration: {type.defaultDurationMinutes} min</p></CardContent></Card></button>)}</div>{!page.appointmentTypes.length ? <PublicMessage title="No appointments available" description="There are no appointment types currently available." /> : null}</section> : <section className="space-y-3"><Button onClick={() => setSelection({ appointmentTypeId: null, selectedDate: null, durationMinutes: null, selectedStart: null })} type="button" variant="outline">Choose another type</Button><Card><CardHeader><div><CardTitle>{selected.name}</CardTitle><CardDescription>Appointment type selected. Date selection and availability will be added in the next step.</CardDescription></div></CardHeader><CardContent><p className="text-sm text-muted-foreground">Your eventual appointment will default to {selected.defaultDurationMinutes} minutes after you choose a day.</p></CardContent></Card></section>}
  </div></PublicFrame>;
};

const PublicFrame = ({ children }: { children: React.ReactNode }) => <main className="min-h-screen bg-slate-50 px-4 py-8 sm:py-14"><div className="mx-auto max-w-3xl rounded-lg border border-border/80 bg-card p-5 shadow-sm sm:p-8">{children}</div></main>;
const PublicMessage = ({ title, description }: { title: string; description: string }) => <div className="py-12 text-center"><h1 className="text-xl font-semibold">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{description}</p></div>;
