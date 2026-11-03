export type WorkspaceThemeId = "wallet" | "wallet-selahtone";
export type WorkspaceColorMode = "light" | "dark";
export type SkyCyclePhase = "dawn" | "day" | "dusk" | "night";

export const DEFAULT_WORKSPACE_THEME: WorkspaceThemeId = "wallet";
export const DEFAULT_WORKSPACE_COLOR_MODE: WorkspaceColorMode = "light";

export const WORKSPACE_TIMEZONE = "Africa/Cairo";
export const DAY_START_HOUR = 6; // 06:00 صباحًا — حلول النهار
export const NIGHT_START_HOUR = 18; // 18:00 مساءً — حلول الليل

export const WORKSPACE_THEME_COOKIE = "selahtone_theme";
export const WORKSPACE_DASHBOARD_BG_COOKIE = "selahtone_dashboard_bg";
export const WORKSPACE_COLOR_MODE_COOKIE = "selahtone_color_mode";

export type WorkspaceThemeVariant = {
  id: WorkspaceThemeId;
  label: string;
  swatch: string;
  ring: string;
};

export type WorkspaceThemeGroup = {
  id: string;
  label: string;
  variants: readonly WorkspaceThemeVariant[];
};

export type WorkspaceDashboardBgMap = Record<WorkspaceThemeId, boolean>;

export type WorkspaceClockSnapshot = {
  hour: number;
  minute: number;
  isDaylight: boolean;
  autoColorMode: WorkspaceColorMode;
  skyPhase: SkyCyclePhase;
  orbitDeg: number;
  periodKey: string;
  timeFormatted: string;
  dateFormatted: string;
  isoDate: string;
  msUntilNextBoundary: number;
};

export type ResolvedWorkspaceColorState = {
  colorMode: WorkspaceColorMode;
  isAutoTimeMode: boolean;
  overridePeriodKey: string | null;
};

export const DEFAULT_DASHBOARD_BG_MAP: WorkspaceDashboardBgMap = {
  wallet: false,
  "wallet-selahtone": false,
};

export const WORKSPACE_THEME_GROUPS: readonly WorkspaceThemeGroup[] = [
  {
    id: "wallet-group",
    label: "الحافظة",
    variants: [
      { id: "wallet", label: "الافتراضي", swatch: "#1e341e", ring: "#9bd86a" },
      { id: "wallet-selahtone", label: "صلة تون", swatch: "#339fc1", ring: "#040b5b" },
    ],
  },
];

export const WORKSPACE_THEMES: readonly WorkspaceThemeVariant[] =
  WORKSPACE_THEME_GROUPS.flatMap((group) => group.variants);

export function resolveWorkspaceTheme(value: string | undefined | null): WorkspaceThemeId {
  if (WORKSPACE_THEMES.some((item) => item.id === value)) {
    return value as WorkspaceThemeId;
  }
  return DEFAULT_WORKSPACE_THEME;
}

export function resolveWorkspaceDashboardBg(
  value: string | undefined | null,
): WorkspaceDashboardBgMap {
  const next: WorkspaceDashboardBgMap = { ...DEFAULT_DASHBOARD_BG_MAP };
  if (!value || value === "none") {
    return next;
  }
  for (const raw of value.split(",")) {
    const id = raw.trim();
    if (WORKSPACE_THEMES.some((item) => item.id === id)) {
      next[id as WorkspaceThemeId] = true;
    }
  }
  return next;
}

export function serializeWorkspaceDashboardBg(map: WorkspaceDashboardBgMap): string {
  const enabled = WORKSPACE_THEMES.map((item) => item.id).filter((id) => map[id]);
  return enabled.length > 0 ? enabled.join(",") : "none";
}

function extractTimeParts(
  date: Date,
  timeZone?: string,
): { year: string; month: string; day: string; hour: number; minute: number; second: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    ...(timeZone ? { timeZone } : {}),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: map.year ?? "2026",
    month: map.month ?? "01",
    day: map.day ?? "01",
    hour: Number(map.hour ?? 0) % 24,
    minute: Number(map.minute ?? 0),
    second: Number(map.second ?? 0),
  };
}

/**
 * يحسب حالة الوقت الفلكية/الزمنية الحالية (النهار 06:00–17:59، الليل 18:00–05:59)
 * وموقع الجرم السماوي على القوس المداري ومفتاح الفترة الحالية.
 */
export function getWorkspaceClockSnapshot(
  now: Date = new Date(),
  timeZone?: string,
): WorkspaceClockSnapshot {
  const parts = extractTimeParts(now, timeZone);
  const { hour, minute, second } = parts;
  const isDaylight = hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR;
  const autoColorMode: WorkspaceColorMode = isDaylight ? "light" : "dark";

  // إزاحة 6 ساعات لتظل ساعات الفجر المبكر (00:00–05:59) ضمن نفس دورة الليل السابقة حتى شروق 06:00
  const shiftedParts = extractTimeParts(new Date(now.getTime() - DAY_START_HOUR * 3_600_000), timeZone);
  const periodKey = `${shiftedParts.year}-${shiftedParts.month}-${shiftedParts.day}-${isDaylight ? "day" : "night"}`;

  let skyPhase: SkyCyclePhase;
  if (!isDaylight) {
    skyPhase = "night";
  } else if (hour < 8) {
    skyPhase = "dawn";
  } else if (hour >= 16 && (hour > 16 || minute >= 30)) {
    skyPhase = "dusk";
  } else {
    skyPhase = "day";
  }

  // زاوية الجرم السماوي على القوس (-50° يسار القوس عند البداية -> 0° الذروة -> +50° يمين القوس عند النهاية)
  const totalMinutes = hour * 60 + minute;
  let progress: number;
  if (isDaylight) {
    progress = (totalMinutes - DAY_START_HOUR * 60) / ((NIGHT_START_HOUR - DAY_START_HOUR) * 60);
  } else {
    const nightMinutes =
      hour >= NIGHT_START_HOUR
        ? totalMinutes - NIGHT_START_HOUR * 60
        : totalMinutes + (24 - NIGHT_START_HOUR) * 60;
    progress = nightMinutes / ((24 - NIGHT_START_HOUR + DAY_START_HOUR) * 60);
  }
  const clamped = Math.max(0, Math.min(1, progress));
  const orbitDeg = Math.round((-50 + clamped * 100) * 10) / 10;

  // حساب الملي ثانية المتبقية حتى التحوّل القادم (06:00 أو 18:00)
  const secondsIntoDay = hour * 3600 + minute * 60 + second;
  const dayStartSec = DAY_START_HOUR * 3600;
  const nightStartSec = NIGHT_START_HOUR * 3600;
  let secondsUntilNext: number;
  if (secondsIntoDay < dayStartSec) {
    secondsUntilNext = dayStartSec - secondsIntoDay;
  } else if (secondsIntoDay < nightStartSec) {
    secondsUntilNext = nightStartSec - secondsIntoDay;
  } else {
    secondsUntilNext = 86_400 - secondsIntoDay + dayStartSec;
  }

  const dateFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    ...(timeZone ? { timeZone } : {}),
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");

  return {
    hour,
    minute,
    isDaylight,
    autoColorMode,
    skyPhase,
    orbitDeg,
    periodKey,
    timeFormatted: `${hh}:${mm}`,
    dateFormatted: dateFormatter.format(now),
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    msUntilNextBoundary: Math.max(1_000, secondsUntilNext * 1_000),
  };
}

/**
 * يحلّل قيمة الكوكي مع الوقت الفعلي:
 * - الافتراضي («auto» أو فارغ): يتبع شروق النهار (06:00 -> light) وحلول الليل (18:00 -> dark) تلقائيًا، دون أي تبعية لإعداد الجهاز.
 * - التبديل اليدوي («manual:light:<periodKey>» أو «manual:dark:<periodKey>»): يسري خلال الفترة الحالية ثم يتحول تلقائيًا عند حلول الفترة التالية (النهار أو الليل).
 * - القيم الصريحة المباشرة («light» أو «dark»): تُحترم كتفضيل فوري.
 */
export function resolveWorkspaceColorModeState(
  value: string | undefined | null,
  now: Date = new Date(),
  timeZone?: string,
): ResolvedWorkspaceColorState {
  const clock = getWorkspaceClockSnapshot(now, timeZone);

  if (!value || value === "auto" || value === "system") {
    return {
      colorMode: clock.autoColorMode,
      isAutoTimeMode: true,
      overridePeriodKey: null,
    };
  }

  if (value === "light" || value === "dark") {
    return {
      colorMode: value,
      isAutoTimeMode: false,
      overridePeriodKey: clock.periodKey,
    };
  }

  const decoded = (() => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  })();

  const match = decoded.match(/^manual:(light|dark):([0-9]{4}-[0-9]{2}-[0-9]{2}-(?:day|night))$/);
  if (match) {
    const [, mode, savedPeriodKey] = match;
    if (savedPeriodKey === clock.periodKey) {
      return {
        colorMode: mode as WorkspaceColorMode,
        isAutoTimeMode: false,
        overridePeriodKey: savedPeriodKey,
      };
    }
    // حلّت الفترة الجديدة (النهار أو الليل) -> يتحوّل النظام تلقائيًا للوضع الطبيعي للفترة الجديدة
    return {
      colorMode: clock.autoColorMode,
      isAutoTimeMode: true,
      overridePeriodKey: null,
    };
  }

  return {
    colorMode: clock.autoColorMode,
    isAutoTimeMode: true,
    overridePeriodKey: null,
  };
}

export function resolveWorkspaceColorMode(
  value: string | undefined | null,
  now: Date = new Date(),
  timeZone?: string,
): WorkspaceColorMode {
  return resolveWorkspaceColorModeState(value, now, timeZone).colorMode;
}

export function serializeWorkspaceColorModeCookie(
  choice: WorkspaceColorMode | "auto",
  clock: WorkspaceClockSnapshot,
): string {
  if (choice === "auto" || choice === clock.autoColorMode) {
    return "auto";
  }
  return `manual:${choice}:${clock.periodKey}`;
}
