'use strict';

const fs = require('fs');
const path = require('path');
const { fetchMacroLive } = require('../lib/macro');

const FRESH_MS = 3 * 24 * 3600 * 1000; // una copia de menos de 3 días se sirve directo

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
 * 1) Si hay copia guardada reciente (data/macro.json, la genera GitHub Actions) -> se sirve directo.
 * 2) Si no, consulta Banco Mundial y FMI (con límite de 8 s por pedido) y completa con la copia.
 * 3) Si la consulta falla, sirve la copia aunque sea vieja. Sin copia -> error JSON claro.
 */
module.exports = async function handler(req, res) {
  const snap = readSnap();
  try {
    const age = snap && snap.meta && snap.meta.generatedAt ? Date.now() - Date.parse(snap.meta.generatedAt) : Infinity;
    if (snap && age < FRESH_MS) {
      snap.meta = { ...snap.meta, origin: 'saved' };
      return send(res, 200, snap, 'public, s-maxage=21600, stale-while-revalidate=86400');
    }
    const data = await fetchMacroLive(snap);
    data.meta.origin = 'live';
    return send(res, 200, data, 'public, s-maxage=86400, stale-while-revalidate=259200');
  } catch (err) {
    if (snap) {
      snap.meta = { ...snap.meta, origin: 'snapshot', liveError: String(err.message || err) };
      return send(res, 200, snap, 'public, s-maxage=900, stale-while-revalidate=3600');
    }
    return send(res, 502, { error: 'Los datos macro todavía no están disponibles.', detail: String(err.message || err) }, 'no-store');
  }
};
