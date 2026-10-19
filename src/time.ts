// 時刻と日付。GTFS の時刻は「運行日の 0 時からの秒」で、24 時を超えてよい（例 25:10:00＝翌 1:10）。

export const INF = 0x7fffffff;
export const DAY = 86400;

/** "HH:MM:SS"（H は 24 以上も可）→ 秒。空なら NaN。 */
export function parseGtfsTime(s: string): number {
  if (!s) return NaN;
  const p = s.trim().split(":");
  if (p.length < 2) return NaN;
  const h = Number(p[0]);
  const m = Number(p[1]);
  const sec = p.length > 2 ? Number(p[2]) : 0;
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(sec)) return NaN;
  return h * 3600 + m * 60 + sec;
}

/** 秒 → "HH:MM:SS"（24 時超えはそのまま） */
export function formatGtfsTime(t: number): string {
  const sign = t < 0 ? "-" : "";
  t = Math.abs(t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** "YYYYMMDD" の日付を n 日ずらす */
export function addDays(ymd: string, n: number): string {
  const d = ymdToUtc(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return utcToYmd(d);
}

export function ymdToUtc(ymd: string): Date {
  return new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))));
}

export function utcToYmd(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** 0=日 … 6=土 */
export function weekday(ymd: string): number {
  return ymdToUtc(ymd).getUTCDay();
}

/**
 * ISO 日時 → 路線データの時間帯での「運行日 YYYYMMDD」と「その日の 0 時からの秒」。
 * 時差（+09:00 や Z）付きなら、その瞬間を tz の現地時刻に直す。時差なしなら、tz の現地時刻とみなす。
 * 注：GTFS は厳密には「正午の 12 時間前」が基準。日本は夏時間が無いので差は出ない。
 */
export function isoToServiceTime(iso: string, tz: string): { date: string; time: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(iso.trim());
  if (!m) throw new Error(`日時の形式が読めません: ${iso}（例 2026-10-19T08:30:00+09:00）`);
  const [, Y, Mo, D, h, mi, s, off] = m;
  if (!off) {
    return { date: `${Y}${Mo}${D}`, time: Number(h) * 3600 + Number(mi) * 60 + Number(s ?? 0) };
  }
  const instant = new Date(`${Y}-${Mo}-${D}T${h}:${mi}:${s ?? "00"}${off.length === 5 ? off.slice(0, 3) + ":" + off.slice(3) : off}`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    date: `${g("year")}${g("month")}${g("day")}`,
    time: Number(g("hour")) * 3600 + Number(g("minute")) * 60 + Number(g("second")),
  };
}

/** 運行日＋秒 → "YYYY-MM-DDTHH:MM:SS"（現地時刻・時差は付けない） */
export function serviceTimeToLocalIso(date: string, t: number): string {
  const dayShift = Math.floor(t / DAY);
  const d = addDays(date, dayShift);
  const rest = t - dayShift * DAY;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${formatGtfsTime(rest)}`;
}
