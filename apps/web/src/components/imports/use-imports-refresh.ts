"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { watchImports } from "@/lib/imports/live";
import { createClient } from "@/lib/supabase/client";

// Several changes within this window re-read the page once.
const REFRESH_DELAY_MS = 250;

// Re-reads the page on each change to one of the user's imports while
// `following`. The channel stays open only that long: an open channel has
// the browser refresh a session near its expiry (lib/supabase/client.ts).
export function useImportsRefresh(userId: string | null, following: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!following || userId === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), REFRESH_DELAY_MS);
    };
    const stop = watchImports(createClient(), userId, refresh);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [following, userId, router]);
}
