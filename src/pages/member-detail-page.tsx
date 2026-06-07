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
    <div className="space-y-4">
      {error ? <ErrorState description={error} title="Member action failed" /> : null}

      <section className="rounded-[2.25rem] bg-[linear-gradient(180deg,#ffffff_0%,#fbfbf8_100%)] p-4 shadow-[0_18px_48px_rgba(16,33,61,0.08)]">
        <div className="flex items-start justify-between">
          <button className="flex items-center gap-2 text-2xl font-semibold text-slate-900" onClick={() => navigate("/members")} type="button">
            <ArrowLeft className="h-5 w-5" />
            Back
          </button>
          <div className="relative">
            <Button onClick={() => setMenuOpen((current) => !current)} size="icon" type="button" variant="ghost">
              <Ellipsis className="h-5 w-5" />
            </Button>
            {menuOpen ? (
              <div className="absolute right-0 top-10 w-44 rounded-[1.5rem] bg-white p-3 shadow-[0_16px_40px_rgba(16,33,61,0.14)]">
                <button className="block w-full rounded-xl px-3 py-2 text-left text-xl font-semibold" onClick={() => setEditing(true)} type="button">
                  Edit
                </button>
                <button className="block w-full rounded-xl px-3 py-2 text-left text-xl font-semibold text-rose-600" onClick={() => void handleDelete()} type="button">
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center text-center">
          <MemberAvatar fullName={member.fullName} initials={member.initials} size="lg" />
          <h1 className="mt-4 text-5xl font-semibold tracking-tight text-slate-900">{member.fullName}</h1>
          <div className="mt-2 text-xl text-[#aa925d]">{member.unityId ? `#unity#${member.unityId}` : `MEMBER#${member.memberId}`}</div>
          <div className="mt-3">
            <UnityBadge source={member.source} unityId={member.unityId} />
          </div>
        </div>

        <div className="mt-6 flex justify-center gap-4">
          {quickActions.map((item) => {
            const Icon = item.icon;
            return (
              <a
                className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50 shadow-sm"
                href={item.href}
                key={item.label}
                rel="noreferrer"
                target={item.href?.startsWith("http") ? "_blank" : undefined}
              >
                <Icon className="h-8 w-8 text-primary" />
              </a>
            );
          })}
        </div>

        <div className="mt-6">
          <MemberDetailsTabs activeTab={activeTab} onChange={setActiveTab} />
        </div>

        <div className="mt-6 rounded-[2rem] border border-border bg-white p-4">
          {activeTab === "details" ? (
            <div className="grid gap-3">
              {[
                ["Role", member.profession || "Not set"],
                ["Status", member.accountStatus || "Not set"],
                ["Phone", member.phone || "Not set"],
                ["Email", member.email || "Not set"],
                ["Address", member.address || "Not set"],
                ["Notes", member.notes || "Not set"],
              ].map(([label, value]) => (
                <div className="rounded-[1.5rem] border border-border p-4" key={label}>
                  <div className="text-sm font-semibold uppercase tracking-[0.18em] text-[#b39b62]">{label}</div>
                  <div className="mt-2 text-lg text-slate-900">{value}</div>
                </div>
              ))}
            </div>
          ) : null}

          {activeTab === "visitations" ? (
            <div className="space-y-4">
              <Button
                className="h-12 w-full rounded-full bg-[#cfe0ff] text-lg font-semibold text-primary hover:bg-[#bdd4ff]"
                onClick={() => navigate(`/calendar/schedule?memberId=${member.memberId}&eventType=VISITATION`)}
                type="button"
              >
                Schedule
              </Button>
              {visitationEvents.length ? (
                <div className="space-y-3">
                  {visitationEvents.map((event) => (
                    <div className="rounded-[1.5rem] border border-border p-4" key={`${event.eventId}-${event.eventStartDateTime}`}>
                      <div className="text-sm font-semibold text-primary">{formatMemberEventLabel(event)}</div>
                      <div className="mt-2 text-lg font-semibold text-slate-900">{event.eventTitleSnapshot}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{new Date(event.eventStartDateTime).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-72 items-center justify-center text-center text-2xl font-semibold text-slate-900">
                  No visitations scheduled yet.
                </div>
              )}
            </div>
          ) : null}

          {activeTab === "activity" ? (
            <div className="space-y-4">
              {activity.map((item) => (
                <div className="flex gap-4" key={item.activityId}>
                  <div className="flex flex-col items-center">
                    <span className="h-4 w-4 rounded-full border-4 border-[#dcebd6] bg-[#477f44]" />
                    <span className="mt-2 h-28 w-1 rounded-full bg-[#d7e5f7]" />
                  </div>
                  <div className="flex-1 rounded-[1.5rem] border border-border p-4">
                    <div className="flex flex-wrap gap-2 text-sm">
                      <span className="rounded bg-[#e3f0de] px-2 py-1 text-[#477f44]">{item.action}</span>
                      <span>{new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="mt-3 text-lg text-slate-900">{item.message}</div>
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
