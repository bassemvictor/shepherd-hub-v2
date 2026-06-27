export type MobileScheduleMode = "classic" | "beta";

export const MOBILE_SCHEDULE_MODE_EVENT = "schedule-mobile-mode-change";
export const MOBILE_SCHEDULE_MODE_PARAM = "mobileView";
export const MOBILE_SCHEDULE_MODE_STORAGE_KEY = "schedule-mobile-view";

export const mobileScheduleModeOptions: Array<{ label: string; value: MobileScheduleMode }> = [
  { label: "Updated", value: "beta" },
  { label: "Classic", value: "classic" },
];

export const normalizeMobileScheduleMode = (value?: string | null): MobileScheduleMode | null =>
  value === "classic" || value === "beta" ? value : null;

export const readStoredMobileScheduleMode = (): MobileScheduleMode => {
  if (typeof window === "undefined") {
    return "beta";
  }

  return normalizeMobileScheduleMode(window.localStorage.getItem(MOBILE_SCHEDULE_MODE_STORAGE_KEY)) ?? "beta";
};

export const writeStoredMobileScheduleMode = (value: MobileScheduleMode) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(MOBILE_SCHEDULE_MODE_STORAGE_KEY, value);
  window.dispatchEvent(new CustomEvent<MobileScheduleMode>(MOBILE_SCHEDULE_MODE_EVENT, { detail: value }));
};
