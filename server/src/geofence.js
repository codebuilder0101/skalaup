// Geolocation check-in geofence (client round 2026-07-19).
//
// A self check-in must happen within a configurable radius of the restaurant.
// The radius + on/off switch are global (app_settings, edited by the admin in
// Configurações); each restaurant carries its own latitude/longitude. A restaurant
// without coordinates cannot be measured, so it falls back to a manual check-in
// rather than locking everyone out.

// Great-circle distance in metres between two lat/lng points (haversine).
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius, metres
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Decide whether a freelancer's own check-in passes the geofence.
// Returns either:
//   { ok: true,  method, latitude, longitude, distanceM }  — record these
//   { ok: false, error, distanceM? }                        — reject; `error` is a
//                                                              pt-BR user message.
// When blocked for being out of range, distanceM is set (used to pick HTTP 403 vs 400).
export function evaluateCheckinGeofence({ enabled, radiusM, restLat, restLng, lat, lng }) {
  const restGeocoded = restLat != null && restLng != null;
  // Disabled globally, or restaurant not geocoded → nothing to enforce.
  if (!enabled || !restGeocoded) {
    return { ok: true, method: "manual", latitude: null, longitude: null, distanceM: null };
  }

  const hasCoords =
    lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  if (!hasCoords) {
    return { ok: false, error: "Ative a localização do celular para fazer o check-in neste restaurante." };
  }

  const radius = Number(radiusM) > 0 ? Number(radiusM) : 150;
  const dist = distanceMeters(Number(restLat), Number(restLng), Number(lat), Number(lng));
  if (dist > radius) {
    return {
      ok: false,
      distanceM: Math.round(dist),
      error: `Você está a ${Math.round(dist)} m do restaurante. O check-in só é permitido dentro de ${radius} m do local.`,
    };
  }

  return { ok: true, method: "gps", latitude: Number(lat), longitude: Number(lng), distanceM: Math.round(dist) };
}
