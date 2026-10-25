'use strict';

const fs = require('fs');
const path = require('path');
const { fetchMacroLive } = require('../lib/macro');

function readSnap() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'macro.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

function send(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (cache) res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(body));
}

/**
 * GET /api/macro
 * Indicadores macro (Banco Mundial + FMI) por país. Cache de CDN 24 h.
 * Si una fuente falla, completa con el snapshot data/macro.json.
 */
module.exports = async function handler(req, res) {
  const snap = readSnap();
  try {
    const data = await fetchMacroLive(snap);
    data.meta.origin = 'live';
    return send(res, 200, data, 'public, s-maxage=86400, stale-while-revalidate=259200');
  } catch (err) {
    if (snap) {
      snap.meta = { ...snap.meta, origin: 'snapshot', liveError: String(err.message || err) };
      return send(res, 200, snap, 'public, s-maxage=900, stale-while-revalidate=3600');
    }
    return send(res, 502, { error: 'No se pudieron obtener los datos macro.', detail: String(err.message || err) }, 'no-store');
  }
};
