"use client";

import { useEffect, useRef, useState } from "react";

import {
  ROUTE_FADE_END_EVENT,
  ROUTE_FADE_MS,
  ROUTE_FADE_START_EVENT,
} from "@/lib/routeFade";

export function RouteFadeOverlay() {
  const [mounted, setMounted] = useState(false);
  const [opaque, setOpaque] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const clearHideTimer = () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    };

    const start = () => {
      clearHideTimer();
      setMounted(true);
      // Ensure CSS transition triggers (opacity 0 -> 100).
      window.requestAnimationFrame(() => setOpaque(true));
    };

    const end = () => {
      clearHideTimer();
      setOpaque(false);
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        setMounted(false);
      }, ROUTE_FADE_MS);
    };

    window.addEventListener(ROUTE_FADE_START_EVENT, start as EventListener);
    window.addEventListener(ROUTE_FADE_END_EVENT, end as EventListener);
    return () => {
      window.removeEventListener(ROUTE_FADE_START_EVENT, start as EventListener);
      window.removeEventListener(ROUTE_FADE_END_EVENT, end as EventListener);
      clearHideTimer();
    };
  }, []);

  if (!mounted) return null;
  return (
    <div
      className={`fixed inset-0 z-[2147483647] bg-black transition-opacity ease-out ${
        opaque ? "opacity-100" : "opacity-0"
      }`}
      style={{
        transitionDuration: `${ROUTE_FADE_MS}ms`,
        pointerEvents: mounted ? "auto" : "none",
      }}
    />
  );
}


