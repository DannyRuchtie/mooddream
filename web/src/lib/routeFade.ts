export const ROUTE_FADE_MS = 220;

export const ROUTE_FADE_START_EVENT = "moondream:route-fade:start";
export const ROUTE_FADE_END_EVENT = "moondream:route-fade:end";

export function dispatchRouteFadeStart() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ROUTE_FADE_START_EVENT));
}

export function dispatchRouteFadeEnd() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ROUTE_FADE_END_EVENT));
}


