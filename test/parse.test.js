'use strict';

/**
 * Prueba el parser con Excel sintéticos que imitan layouts posibles del BCRD
 * (títulos arriba, encabezado en dos filas, fechas como serial o texto, celdas vacías / "-").
 */

const assert = require('assert');
const XLSX = require('xlsx');
const { parseWorkbook } = require('../lib/parse');

function build(aoa, sheetName = 'EMBI') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const serial = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000) + 25569;

// Layout A: títulos + encabezado en 2 filas, fechas serial, orden descendente, huecos y "-"
{
  const aoa = [
    ['Spread del EMBI Global'],
    ['Puntos básicos'],
    [],
    [null, 'EMBI', 'Países'],
    ['Fecha', 'Global', 'Argentina', 'Brasil', 'Chile', 'Vacía'],
  ];
  const dates = [];
  for (let i = 0; i < 40; i++) dates.push(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
  dates.reverse().forEach((d, i) => aoa.push([serial(d), 300 + i, i === 3 ? '-' : 600 + i, 200 + i, i === 5 ? null : 120 + i, null]));

  const out = parseWorkbook(build(aoa));
  assert.strictEqual(out.dates.length, 40);
  assert.strictEqual(out.dates[0], '2026-01-01', 'ordena ascendente');
  assert.strictEqual(out.dates[39], '2026-02-09');
  assert.ok(out.series['Argentina'] && out.series['Brasil'] && out.series['Chile']);
  assert.ok(!out.series['Vacía'], 'descarta columnas sin datos');
  assert.strictEqual(out.series['Argentina'].filter((v) => v === null).length, 1, '"-" -> null');
  assert.strictEqual(out.series['Brasil'][39], 200, 'valor de la fecha más antigua (última fila)');
  assert.strictEqual(out.meta.from, '2026-01-01');
}

// Layout B: fechas como texto dd/mm/yyyy, decimales con coma, fecha en la 2ª columna
{
  const aoa = [['Serie histórica'], ['N°', 'Fecha', 'Argentina', 'México']];
  for (let i = 1; i <= 30; i++) aoa.push([i, `${String(i).padStart(2, '0')}/03/2025`, `${700 + i},5`, 150 + i]);
  const out = parseWorkbook(build(aoa));
  assert.strictEqual(out.dates.length, 30);
  assert.strictEqual(out.dates[0], '2025-03-01');
  assert.strictEqual(out.series['Argentina'][0], 701.5);
  assert.ok(!out.series['N°'], 'la columna de índice (sin nombre válido de país) no cuenta como fecha');
}

// Hoja irrelevante + hoja con datos
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Notas'], ['Texto']]), 'Notas');
  const aoa = [['Fecha', 'Argentina']];
  for (let i = 0; i < 20; i++) aoa.push([serial('2024-05-01') + i, 500 + i]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Datos');
  const out = parseWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  assert.strictEqual(out.meta.sheet, 'Datos');
  assert.strictEqual(out.dates.length, 20);
}

// Layout real del BCRD: título, encabezado "Fecha | Global | LATINO | REP DOM | ...",
// valores en puntos porcentuales (2,1 = 210 pb), "N/A" y columna de diferencial "RD-LATINO"
{
  const aoa = [['EMBI Global Diversified Subindices'], ['Fecha', 'Global', 'LATINO', 'REP DOM', 'Argentina', 'Bolivia', 'RD-LATINO']];
  for (let i = 0; i < 25; i++) aoa.push([serial('2025-01-01') + i, 2.1 + i / 100, 2.3, 2.28, 7.06, i < 10 ? 'N/A' : 5.03672, -0.04]);
  aoa.push([null, null], [null, null]); // filas vacías al final
  const out = parseWorkbook(build(aoa, 'Serie Histórica'));
  assert.strictEqual(out.meta.scaleApplied, 100);
  assert.strictEqual(out.series['Argentina'][0], 706, 'pp -> pb');
  assert.strictEqual(out.series['Bolivia'][0], null, 'N/A -> null');
  assert.strictEqual(out.series['Bolivia'][24], 503.67);
  assert.ok(out.series['Rep. Dominicana'] && out.series['EMBI Global'] && out.series['EMBI Latino'], 'renombra columnas');
  assert.ok(!out.series['RD-LATINO'], 'descarta el diferencial');
  assert.deepStrictEqual(out.meta.aggregates, ['EMBI Global', 'EMBI Latino']);
  assert.strictEqual(out.dates.length, 25);
}

// Archivo sin datos -> error claro
assert.throws(() => parseWorkbook(build([['hola'], ['mundo']])), /No se encontró/);

(async () => {
  // Handler de la API con fetch simulado
  const handler = require('../api/embi');
  const aoa = [['Fecha', 'Argentina', 'Brasil']];
  for (let i = 0; i < 15; i++) aoa.push([serial('2026-06-01') + i, 600 + i, 200 + i]);
  const buf = build(aoa);

  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
  const res = fakeRes();
  await handler({}, res);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(/s-maxage/.test(res.headers['Cache-Control']));
  const body = JSON.parse(res.body);
  assert.strictEqual(body.meta.origin, 'live');
  assert.strictEqual(body.dates.length, 15);

  // Falla la descarga y no hay snapshot -> 502 (o snapshot si existe)
  global.fetch = async () => { throw new Error('sin red'); };
  const res2 = fakeRes();
  await handler({}, res2);
  assert.ok([200, 502].includes(res2.statusCode));
  global.fetch = realFetch;

  console.log('OK: todos los tests pasaron');
})().catch((e) => { console.error(e); process.exit(1); });

function fakeRes() {
  return {
    statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b; },
  };
}
