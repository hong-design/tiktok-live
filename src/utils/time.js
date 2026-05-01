export function nowIso() {
  return new Date().toISOString();
}

export function secondsToMs(seconds) {
  return Number(seconds) * 1000;
}
