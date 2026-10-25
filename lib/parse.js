'use strict';

/**
 * Parser tolerante para "Serie_Historica_Spread_del_EMBI.xlsx" (BCRD).
 *
 * No asume posiciones fijas: detecta
 *   - la hoja con más fechas,
 *   - la columna de fechas,
 *   - la primera fila de datos,
 *   - los nombres de países (primer texto no vacío hacia arriba desde los datos).
 */

const XLSX = require('xlsx');

const SOURCE_URL =
  'https://bcrdgdcprod.blob.core.windows.net/documents/entorno-internacional/documents/Serie_Historica_Spread_del_EMBI.xlsx';

// Serial de Excel plausible para fechas entre 1987 y 2064
const MIN_SERIAL = 32000;
const MAX_SERIAL = 60000;

function serialToISO(n) {
  const ms = Math.round((n - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Devuelve 'YYYY-MM-DD' o null si el valor no parece una fecha. */
function toISODate(v) {
  if (typeof v === 'number') {
    return v >= MIN_SERIAL && v <= MAX_SERIAL ? serialToISO(v) : null;
  }
  if (v instanceof Date && !isNaN(v)) {
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()))
      .toISOString()
      .slice(0, 10);
  }
  if (typeof v === 'string') {
    const s = v.trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/); // dd/mm/yyyy
    if (m) {
      let y = Number(m[3]);
      if (y < 100) y += y > 50 ? 1900 : 2000;
      const d = Number(m[1]);
      const mo = Number(m[2]);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
    }
  }
  return null;
}

function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim().replace(/\s/g, '').replace(',', '.');
    if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Nombres del archivo del BCRD -> nombres para mostrar
const DISPLAY = { 'REP DOM': 'Rep. Dominicana', LATINO: 'EMBI Latino', Global: 'EMBI Global' };
const AGGREGATES = ['EMBI Global', 'EMBI Latino'];
const EXCLUDE = /^RD\s*-/i;

function median(arr) {
  const a = arr.filter((v) => v !== null).sort((x, y) => x - y);
  return a.length ? a[a.length >> 1] : NaN;
}

function cleanName(v) {
  return String(v).replace(/\s+/g, ' ').trim();
}

/** Analiza una hoja (array de arrays). Devuelve null si no encuentra fechas. */
function analyzeSheet(rows) {
  const width = rows.reduce((w, r) => Math.max(w, r ? r.length : 0), 0);
  let best = { col: -1, count: 0 };
  for (let c = 0; c < width; c++) {
    let count = 0;
    for (const r of rows) if (r && toISODate(r[c])) count++;
    if (count > best.count) best = { col: c, count };
  }
  if (best.count < 10) return null;
  const dateCol = best.col;

  // Primera fila de datos: primera fila que inicia una racha de fechas consecutivas
  let first = -1;
  for (let i = 0; i < rows.length; i++) {
    let ok = true;
    for (let k = 0; k < 5 && i + k < rows.length; k++) {
      if (!rows[i + k] || !toISODate(rows[i + k][dateCol])) {
        ok = false;
        break;
      }
    }
    if (ok) {
      first = i;
      break;
    }
  }
  if (first < 0) return null;

  const dataRows = [];
  for (let i = first; i < rows.length; i++) {
    const r = rows[i];
    const d = r && toISODate(r[dateCol]);
    if (d) dataRows.push({ date: d, row: r });
  }

  const series = [];
  const used = new Map();
  for (let c = 0; c < width; c++) {
    if (c === dateCol) continue;

    let name = null;
    for (let i = first - 1; i >= Math.max(0, first - 6); i--) {
      const v = rows[i] && rows[i][c];
      if (typeof v === 'string' && v.trim() !== '') {
        name = cleanName(v);
        break;
      }
    }
    if (!name || /^(fecha|date|per[ií]odo|n[°º.]?|nro\.?|#|item|[ií]ndice)$/i.test(name)) continue;
    if (EXCLUDE.test(name)) continue; // columnas de diferencial (p. ej. "RD-LATINO")
    name = DISPLAY[name] || name;

    const values = dataRows.map(({ row }) => toNumber(row[c]));
    const n = values.filter((v) => v !== null).length;
    if (n < 10) continue;

    const seen = (used.get(name) || 0) + 1;
    used.set(name, seen);
    series.push({ name: seen > 1 ? `${name} (${seen})` : name, values });
  }
  if (!series.length) return null;

  return { dateCol, first, dataRows, series };
}

/** buffer (xlsx) -> { meta, dates, series } con fechas ascendentes y sin duplicados. */
function parseWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  let best = null;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const a = analyzeSheet(rows);
    if (a && (!best || a.dataRows.length * a.series.length > best.a.dataRows.length * best.a.series.length)) {
      best = { sheetName, a };
    }
  }
  if (!best) {
    throw new Error('No se encontró una hoja con fechas y series numéricas en el Excel.');
  }

  const { a, sheetName } = best;

  // Ordenar por fecha y deduplicar (gana la última aparición)
  const byDate = new Map();
  a.dataRows.forEach(({ date }, idx) => byDate.set(date, idx));
  const dates = [...byDate.keys()].sort();

  const series = {};
  const names = [];
  for (const s of a.series) {
    series[s.name] = dates.map((d) => s.values[byDate.get(d)]);
    names.push(s.name);
  }

  // El archivo del BCRD publica el spread en puntos porcentuales (2,10 = 210 pb).
  // Si la mediana global es chica, se convierte a puntos básicos.
  const all = [].concat(...names.map((n) => series[n]));
  const scale = median(all) < 40 ? 100 : 1;
  if (scale !== 1) {
    for (const n of names) {
      series[n] = series[n].map((v) => (v === null ? null : Math.round(v * scale * 100) / 100));
    }
  }

  return {
    meta: {
      source: SOURCE_URL,
      sheet: sheetName,
      unit: 'puntos básicos',
      scaleApplied: scale,
      aggregates: names.filter((n) => AGGREGATES.includes(n)),
      generatedAt: new Date().toISOString(),
      from: dates[0],
      to: dates[dates.length - 1],
      rows: dates.length,
      names,
    },
    dates,
    series,
  };
}

module.exports = { parseWorkbook, toISODate, toNumber, SOURCE_URL };
