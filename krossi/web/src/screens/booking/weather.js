// weather.js — the forecast for outdoor courts, so a player booking Kisapuisto sees "☀️ 14° ·
// sade 10 %" before paying. Open-Meteo: free, no key, and the request carries only the court's
// coordinates. One request per place per page load; any failure just hides the weather.
import { useEffect, useState } from 'react';

const cache = new Map(); // 'lat,lng' -> Promise<{ [utcHour]: { temp, rain, code } }>

function load(lat, lng) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (!cache.has(key)) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
      + '&hourly=temperature_2m,precipitation_probability,weather_code&forecast_days=14&timezone=UTC';
    const request = fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`forecast ${res.status}`))))
      .then(({ hourly }) => {
        const hours = {};
        hourly.time.forEach((time, i) => {
          hours[time] = { temp: hourly.temperature_2m[i], rain: hourly.precipitation_probability[i], code: hourly.weather_code[i] };
        });
        return hours;
      })
      .catch((err) => { cache.delete(key); throw err; });
    cache.set(key, request);
  }
  return cache.get(key);
}

/** '2026-10-15T15:00' — Open-Meteo's UTC hour key for an ISO instant. */
const hourKey = (iso) => `${new Date(iso).toISOString().slice(0, 13)}:00`;

/** The forecast hour for an outdoor location at `startsAt`, or null (indoors, too far ahead, offline). */
export function useForecast(location, startsAt) {
  const [weather, setWeather] = useState(null);
  const outdoor = location && !location.indoor && location.lat != null && location.lng != null;
  useEffect(() => {
    setWeather(null);
    if (!outdoor || !startsAt) return undefined;
    let live = true;
    load(location.lat, location.lng)
      .then((hours) => { if (live) setWeather(hours[hourKey(startsAt)] || null); })
      .catch((err) => { console.info('[krossi] no forecast', err?.message); });
    return () => { live = false; };
  }, [outdoor, location?.lat, location?.lng, startsAt]);
  return weather;
}

// WMO weather codes -> a symbol and a word.
function describe(code) {
  if (code === 0) return ['☀️', 'Selkeää'];
  if (code <= 2) return ['🌤️', 'Puolipilvistä'];
  if (code === 3) return ['☁️', 'Pilvistä'];
  if (code === 45 || code === 48) return ['🌫️', 'Sumua'];
  if (code >= 51 && code <= 57) return ['🌦️', 'Tihkua'];
  if (code >= 61 && code <= 67) return ['🌧️', 'Sadetta'];
  if (code >= 71 && code <= 77) return ['🌨️', 'Lunta'];
  if (code >= 80 && code <= 82) return ['🌦️', 'Sadekuuroja'];
  if (code >= 85 && code <= 86) return ['🌨️', 'Lumikuuroja'];
  if (code >= 95) return ['⛈️', 'Ukkosta'];
  return ['🌡️', ''];
}

/** { symbol, text: 'Puolipilvistä 14° · sade 10 %', wet } */
export function weatherInfo(weather) {
  if (!weather) return null;
  const [symbol, word] = describe(weather.code);
  const rain = weather.rain ?? 0;
  return {
    symbol,
    text: `${word ? `${word} ` : ''}${Math.round(weather.temp)}°, sade ${rain}\u00a0%`,
    wet: rain >= 50,
  };
}
