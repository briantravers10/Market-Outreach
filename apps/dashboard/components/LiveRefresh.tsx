"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls router.refresh() on an interval so pages showing live team/campaign
 * status feel current without a full websocket/SSE setup — this is a
 * low-frequency internal tool backed by a single SQLite file, so polling is
 * simpler and has zero new infrastructure. Renders nothing.
 */
export function LiveRefresh({ intervalMs = 6000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
