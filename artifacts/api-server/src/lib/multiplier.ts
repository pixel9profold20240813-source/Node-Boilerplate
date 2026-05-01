let xpMultiplier = 1;
let eventActive = false;

export const EVENT_MULTIPLIER = 3;

export function getMultiplier(): number {
  return xpMultiplier;
}

export function isEventActive(): boolean {
  return eventActive;
}

export function startEvent(): void {
  xpMultiplier = EVENT_MULTIPLIER;
  eventActive = true;
}

export function stopEvent(): void {
  xpMultiplier = 1;
  eventActive = false;
}
