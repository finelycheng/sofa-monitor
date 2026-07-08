export function parsePrice(text) {
  const m = (text || '').match(/Rp\s?([\d.]+)/);
  if (!m) return null;
  return parseInt(m[1].replace(/\./g, ''), 10);
}

export function parseSoldLabel(text) {
  // 形态:"2rb+ terjual" / "Terjual 750+" / "Terjual 1,2jt+"
  const m = (text || '').match(/(?:terjual\s+)?([\d.,]+\s?(?:rb|jt)?\+?)(?:\s+terjual)?/i);
  if (!m || !/terjual/i.test(text || '')) return null;
  const bucket = m[1].replace(/\s/g, '');
  let num = parseFloat(bucket.replace(',', '.').replace(/[^\d.]/g, ''));
  if (isNaN(num)) return null;
  if (/jt/i.test(bucket)) num *= 1_000_000;
  else if (/rb/i.test(bucket)) num *= 1000;
  return { bucket, value: Math.round(num) };
}

export function parseRatingLine(text) {
  const m = (text || '').match(/(\d\.\d)\s*\(([\d.,]+)\s*rating\)/i);
  if (!m) return null;
  return { rating: parseFloat(m[1]), ratingCount: parseInt(m[2].replace(/[.,]/g, ''), 10) };
}
