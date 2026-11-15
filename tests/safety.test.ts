import { describe, expect, test } from 'bun:test';
import {validateSafetyPosition, googleMapsLink, isSafetyKind} from '../src/lib/safety.ts';

describe('one-time safety location guard', () => {
  const now = Date.parse('2026-11-15T15:00:00.000Z');
  const valid = {latitude: 9.6615, longitude: 80.0255, accuracy_m: 28, observed_at: new Date(now).toISOString()};
  test('accepts a recent user-provided snapshot', () => {
    expect(validateSafetyPosition(valid, now)).toEqual(valid);
  });
  test('rejects stale, future, malformed and inaccurate locations', () => {
    expect(validateSafetyPosition({...valid,observed_at:new Date(now-180000).toISOString()},now)).toBeNull();
    expect(validateSafetyPosition({...valid,observed_at:new Date(now+30000).toISOString()},now)).toBeNull();
    expect(validateSafetyPosition({...valid,latitude:Infinity},now)).toBeNull();
    expect(validateSafetyPosition({...valid,latitude:91},now)).toBeNull();
    expect(validateSafetyPosition({...valid,accuracy_m:10001},now)).toBeNull();
    expect(validateSafetyPosition({...valid,longitude:'80.02'},now)).toBeNull();
  });
  test('maps link is a single location snapshot, never a tracking URL',()=>{
    expect(googleMapsLink(valid)).toBe('https://www.google.com/maps?q=9.661500,80.025500');
  });
  test('only approved safety actions are accepted',()=>{
    expect(isSafetyKind('sos')).toBe(true);
    expect(isSafetyKind('track')).toBe(false);
  });
});
