import { ArrowLeft, Ellipsis, Mail, MessageCircle, Phone, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { Member, MemberActivity, MemberDetailResponse, MemberEvent } from "../../shared/types";
import {
  MemberAvatar,
  MemberDetailsTabs,
  MemberFormDialog,
  UnityBadge,
  formatMemberEventLabel,
} from "../components/members/member-ui";
import { ErrorState } from "../components/states/error-state";
import { LoadingState } from "../components/states/loading-state";
import { Button } from "../components/ui/button";
import { api } from "../lib/api";

const isDateOnlyValue = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const formatMemberEventDateTime = (event: MemberEvent) => {
  if (event.allDay || isDateOnlyValue(event.eventStartDateTime)) {
    const [year, month, day] = event.eventStartDateTime.slice(0, 10).split("-").map(Number);
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(event.eventStartDateTime));
};

export const MemberDetailPage = () => {
  const navigate = useNavigate();
  const { memberId = "" } = useParams();
  const [member, setMember] = useState<Member | null>(null);
  const [activity, setActivity] = useState<MemberActivity[]>([]);
  const [events, setEvents] = useState<MemberEvent[]>([]);
  const [activeTab, setActiveTab] = useState<"details" | "visitations" | "activity">("details");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const loadMember = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [details, memberEvents] = await Promise.all([
        api.get<MemberDetailResponse>(`/members/${memberId}`),
        api.get<{ items: MemberEvent[] }>(`/members/${memberId}/events`),
      ]);
      setMember(details.member);
      setActivity(details.activity);
      setEvents(memberEvents.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load member.");
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    void loadMember();
  }, [loadMember]);

  const visitationEvents = useMemo(
    () => events.filter((item) => item.eventType === "VISITATION"),
    [events],
  );

  const quickActions = useMemo(() => {
    if (!member) {
      return [];
    }

    return [
      { href: member.phone ? `tel:${member.phone}` : undefined, icon: Phone, label: "Call" },
      { href: member.phone ? `sms:${member.phone}` : undefined, icon: MessageCircle, label: "Text" },
      { href: member.whatsappPhone ? `https://wa.me/${member.whatsappPhone.replace(/\D/g, "")}` : undefined, icon: MessageCircle, label: "WhatsApp" },
      { href: member.email ? `mailto:${member.email}` : undefined, icon: Mail, label: "Email" },
    ].filter((item) => item.href);
  }, [member]);

  const handleSave = useCallback(async (value: Partial<Member>) => {
    setSaving(true);
    try {
      await api.put(`/members/${memberId}`, value);
      setEditing(false);
      await loadMember();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update member.");
    } finally {
      setSaving(false);
    }
  }, [loadMember, memberId]);

  const handleDelete = useCallback(async () => {
    try {
      await api.delete(`/members/${memberId}`);
      navigate("/members");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete member.");
    }
  }, [memberId, navigate]);

  if (loading) {
    return <LoadingState description="Loading member profile." title="Preparing member" />;
  }

  if (!member) {
    return <ErrorState description={error ?? "Member not found."} title="Unable to load member" />;
  }

  return (
    <div className="space-y-3">
      {error ? <ErrorState description={error} title="Member action failed" /> : null}

      <section className="rounded-lg border border-border bg-white p-3 panel-shadow">
        <div className="flex items-start justify-between">
          <button className="flex items-center gap-2 text-sm font-semibold text-slate-900" onClick={() => navigate("/members")} type="button">
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="relative">
            <Button onClick={() => setMenuOpen((current) => !current)} size="icon" type="button" variant="ghost">
              <Ellipsis className="h-4 w-4" />
            </Button>
            {menuOpen ? (
              <div className="absolute right-0 top-9 z-10 w-36 rounded-md border border-border bg-white p-1.5 shadow-lg">
                <button className="block w-full rounded-sm px-2 py-1.5 text-left text-sm font-medium hover:bg-accent" onClick={() => setEditing(true)} type="button">
                  Edit
                </button>
                <button className="block w-full rounded-sm px-2 py-1.5 text-left text-sm font-medium text-rose-600 hover:bg-rose-50" onClick={() => void handleDelete()} type="button">
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex flex-col items-center text-center">
          <MemberAvatar fullName={member.fullName} initials={member.initials} size="lg" />
          <div className="mt-2.5 flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{member.fullName}</h1>
            <UnityBadge source={member.source} unityId={member.unityId} />
          </div>
        </div>

        <div className="mt-3 flex justify-center gap-2">
          {quickActions.map((item) => {
            const Icon = item.icon;
            return (
              <a
                className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background transition-colors hover:bg-accent"
                href={item.href}
                key={item.label}
                rel="noreferrer"
                target={item.href?.startsWith("http") ? "_blank" : undefined}
              >
                <Icon className="h-4 w-4 text-primary" />
              </a>
            );
          })}
        </div>

        <div className="mt-3">
          <MemberDetailsTabs activeTab={activeTab} onChange={setActiveTab} />
        </div>

        <div className="mt-2.5 rounded-lg border border-border bg-background/50 p-3">
          {activeTab === "details" ? (
            <div className="grid gap-2">
              {[
                [member.unityId ? "UNITY ID" : "MEMBER ID", member.unityId ?? member.memberId],
                ["Phone", member.phone || "Not set"],
                ["Email", member.email || "Not set"],
                ["Address", member.address || "Not set"],
                ["Notes", member.notes || "Not set"],
              ].map(([label, value]) => (
                <div className="rounded-md border border-border bg-white px-3 py-2.5" key={label}>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
                  <div className="mt-1 text-sm text-slate-900">{value}</div>
                </div>
              ))}
            </div>
          ) : null}

          {activeTab === "visitations" ? (
            <div className="space-y-3">
              <Button
                className="w-full"
                size="sm"
                onClick={() => navigate(`/calendar/schedule?memberId=${member.memberId}&eventType=VISITATION`)}
                type="button"
              >
                Schedule
              </Button>
              {visitationEvents.length ? (
                <div className="space-y-2">
                  {visitationEvents.map((event) => (
                    <button
                      className="w-full rounded-md border border-border bg-white px-3 py-2.5 text-left transition-colors hover:border-primary/25 hover:bg-accent"
                      key={`${event.eventId}-${event.eventStartDateTime}`}
                      onClick={() =>
                        navigate(
                          `/calendar/schedule?eventId=${encodeURIComponent(event.eventId)}&date=${encodeURIComponent(event.eventStartDateTime)}`,
                        )
                      }
                      type="button"
                    >
                      <div className="text-xs font-semibold text-primary">{formatMemberEventLabel(event)}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">{event.eventTitleSnapshot}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{formatMemberEventDateTime(event)}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-border bg-white px-4 text-center text-sm font-medium text-muted-foreground">
                  No visitations scheduled yet.
                </div>
              )}
            </div>
          ) : null}

          {activeTab === "activity" ? (
            <div className="space-y-3">
              {activity.map((item) => (
                <div className="flex gap-3" key={item.activityId}>
                  <div className="flex flex-col items-center">
                    <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                    <span className="mt-1.5 h-full min-h-10 w-px rounded-full bg-border" />
                  </div>
                  <div className="flex-1 rounded-md border border-border bg-white px-3 py-2.5">
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="rounded-sm bg-accent px-1.5 py-0.5 font-medium text-accent-foreground">{item.action}</span>
                      <span className="text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="mt-1.5 text-sm text-slate-900">{item.message}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <MemberFormDialog
        busy={saving}
        initialValue={member}
        onClose={() => setEditing(false)}
        onSubmit={handleSave}
        open={editing}
        title="Edit Member"
      />
    </div>
  );
};
