'use strict';

const fs = require('fs');
const path = require('path');
const { parseWorkbook, SOURCE_URL } = require('../lib/parse');

function send(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (cache) res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(body));
}

/**
 * GET /api/embi
 * Descarga el Excel del BCRD, lo parsea y devuelve JSON columnar.
 * Si la descarga falla, responde con el último snapshot versionado (data/embi.json).
 * El CDN de Vercel cachea 6 h y sirve versión vieja hasta 24 h mientras revalida.
 */
module.exports = async function handler(req, res) {
  try {
    const r = await fetch(SOURCE_URL, { headers: { 'user-agent': 'embi-latam/1.0' } });
    if (!r.ok) throw new Error(`BCRD respondió HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const data = parseWorkbook(buf);
    data.meta.origin = 'live';
    return send(res, 200, data, 'public, s-maxage=21600, stale-while-revalidate=86400');
  } catch (err) {
    try {
      const file = path.join(__dirname, '..', 'data', 'embi.json');
      const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
      snap.meta = { ...snap.meta, origin: 'snapshot', liveError: String(err.message || err) };
      return send(res, 200, snap, 'public, s-maxage=600, stale-while-revalidate=3600');
    } catch (_) {
      return send(
        res,
        502,
        { error: 'No se pudo obtener la serie del BCRD y no hay snapshot disponible.', detail: String(err.message || err) },
        'no-store'
      );
    }
  }
};
