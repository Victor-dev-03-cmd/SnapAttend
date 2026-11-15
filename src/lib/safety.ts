export type SafetyKind = 'checkin' | 'sos' | 'parent_request';

export type SafetyPosition = {
  latitude: number;
  longitude: number;
  accuracy_m: number;
  observed_at: string;
};

export function validateSafetyPosition(value: unknown, now = Date.now()): SafetyPosition | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const latitude = item.latitude;
  const longitude = item.longitude;
  const accuracy_m = item.accuracy_m;
  const observed_at = item.observed_at;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  if (typeof accuracy_m !== 'number' || !Number.isFinite(accuracy_m) || accuracy_m < 0 || accuracy_m > 10000) return null;
  if (typeof observed_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(observed_at)) return null;
  const timestamp = Date.parse(observed_at);
  if (!Number.isFinite(timestamp) || timestamp > now + 15000 || now - timestamp > 120000) return null;
  return {latitude, longitude, accuracy_m, observed_at};
}

export function googleMapsLink(position: Pick<SafetyPosition, 'latitude' | 'longitude'>): string {
  return 'https://www.google.com/maps?q=' + position.latitude.toFixed(6) + ',' + position.longitude.toFixed(6);
}

export function isSafetyKind(value: unknown): value is SafetyKind {
  return value === 'checkin' || value === 'sos' || value === 'parent_request';
}
