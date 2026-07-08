export async function fetchFx() {
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/CNY', { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const idr = j?.rates?.IDR;
    return idr ? { idrPerCny: Math.round(idr) } : null;
  } catch { return null; }
}
