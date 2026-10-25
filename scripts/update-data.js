'use strict';

/**
 * Genera los snapshots de respaldo en data/.
 *   node scripts/update-data.js                  -> EMBI (BCRD) + calificaciones (Wikipedia)
 *   node scripts/update-data.js ./archivo.xlsx   -> EMBI desde un Excel local
 *   node scripts/update-data.js --only=embi|ratings
 *
 * Si una de las dos fuentes falla, conserva el snapshot anterior de esa fuente y sigue con la otra.
 */

const fs = require('fs');
const path = require('path');
const { parseWorkbook, SOURCE_URL } = require('../lib/parse');
const { fetchRatingsLive } = require('../lib/ratings');
const { fetchMacroLive } = require('../lib/macro');

const DATA = path.join(__dirname, '..', 'data');

function write(name, obj) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, name), JSON.stringify(obj));
}

async function updateEmbi(local) {
  let buf;
  if (local) {
    buf = fs.readFileSync(local);
  } else {
    const r = await fetch(SOURCE_URL, { headers: { 'user-agent': 'embi-latam/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} al descargar ${SOURCE_URL}`);
    buf = Buffer.from(await r.arrayBuffer());
  }
  const data = parseWorkbook(buf);
  write('embi.json', data);
  console.log(`EMBI OK: ${data.meta.rows} fechas (${data.meta.from} → ${data.meta.to}), ${data.meta.names.length} series: ${data.meta.names.join(', ')}`);
}

async function updateRatings() {
  let overrides = {};
  try {
    overrides = JSON.parse(fs.readFileSync(path.join(DATA, 'ratings.overrides.json'), 'utf8'));
  } catch (_) {}
  const data = await fetchRatingsLive(overrides);
  write('ratings.json', data);
  const lines = Object.entries(data.ratings).map(
    ([c, r]) => `  ${c.padEnd(16)} S&P ${(r.sp && r.sp.rating) || '-'} | Moody's ${(r.moodys && r.moodys.rating) || '-'} | Fitch ${(r.fitch && r.fitch.rating) || '-'} → ${r.composite || 's/n'} (${r.group})`
  );
  console.log('Calificaciones OK:\n' + lines.join('\n'));
}

async function updateMacro() {
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(path.join(DATA, 'macro.json'), 'utf8')); } catch (_) {}
  const data = await fetchMacroLive(prev);
  write('macro.json', data);
  const n = Object.values(data.countries).reduce((a, c) => a + Object.keys(c.values).length, 0);
  console.log(`Macro OK: ${n} series país×indicador; años FMI ${data.meta.imfYears[0]}–${data.meta.imfYears.slice(-1)[0]}` +
    (data.meta.stale.length ? `\n  Atención, indicadores que fallaron (se conservó lo anterior): ${data.meta.stale.join(', ')}\n  ${JSON.stringify(data.meta.errors)}` : ''));
}

async function main() {
  const args = process.argv.slice(2);
  const only = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1];
  const local = args.find((a) => !a.startsWith('--'));
  let failed = 0;

  if (!only || only === 'embi') {
    try { await updateEmbi(local); } catch (e) { failed++; console.error('EMBI falló:', e.message); }
  }
  if (!only || only === 'ratings') {
    try { await updateRatings(); } catch (e) { failed++; console.error('Calificaciones fallaron:', e.message); }
  }
  if (!only || only === 'macro') {
    try { await updateMacro(); } catch (e) { failed++; console.error('Macro falló:', e.message); }
  }
  if (failed) process.exitCode = 1;
}

main();
