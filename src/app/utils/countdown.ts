import { useEffect, useState } from 'react';

/**
 * Milliseconds remaining until `targetIso`, updated every second. Returns
 * null when there's no target (no timer set). Never goes negative — once
 * the target passes it clamps to 0 and stays there (the session itself gets
 * closed server-side by pg_cron; see 20260707150000_session_auto_close.sql).
 */
export function useCountdownMs(targetIso: string | null | undefined): number | null {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!targetIso) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetIso]);

  if (!targetIso) return null;
  const targetMs = new Date(targetIso).getTime();
  return Math.max(0, targetMs - nowMs);
}

/** "mm:ss" for anything under an hour, "h:mm:ss" beyond that. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}
