'use strict';

const assert = require('assert');
const { parseAgencyTables, buildRatings, ratingScore, groupOf, parseDate } = require('../lib/ratings');

// HTML sintético con el layout descripto de Wikipedia: un encabezado por agencia,
// wikitables Country/Rating/Outlook/Date, banderas, referencias [1] y el menos tipográfico (−).
const html = `
<div class="mw-heading mw-heading2"><h2 id="Standard_&amp;_Poor's">Standard &amp; Poor's</h2></div>
<table class="wikitable sortable">
 <tbody>
  <tr><th>Country/Territory</th><th>Rating</th><th>Outlook</th><th>Date</th><th>Ref.</th></tr>
  <tr><td><span class="flagicon"><img alt=""></span> <a>Argentina</a></td><td>B−</td><td>Stable</td><td>10 June 2026</td><td><sup>[1]</sup></td></tr>
  <tr><td><a>Brazil</a></td><td>BB<sup class="reference">[2]</sup></td><td>Stable</td><td>19 December 2023</td><td></td></tr>
  <tr><td>Chile</td><td>A</td><td>Stable</td><td>24 March 2021</td><td></td></tr>
 </tbody>
</table>
<div class="mw-heading mw-heading2"><h2 id="Fitch">Fitch</h2></div>
<div class="table-wrap"><table class="wikitable">
  <tr><th>Country</th><th>Rating</th><th>Outlook</th><th>Date</th></tr>
  <tr><td>Argentina</td><td>B-</td><td>Positive</td><td>5 May 2026</td></tr>
  <tr><td>Brazil</td><td>BB</td><td></td><td>25 June 2025</td></tr>
  <tr><td>Chile</td><td>A−</td><td>Stable</td><td>26 September 2025</td></tr>
</table></div>
<div class="mw-heading mw-heading2"><h2 id="Moody's">Moody's</h2></div>
<table class="wikitable">
  <tr><th>Country/Territory</th><th>Rating</th><th>Outlook</th><th>Date</th></tr>
  <tr><td>Argentina</td><td>Caa1</td><td>Stable</td><td>17 July 2025</td></tr>
  <tr><td>Brazil</td><td>Ba1</td><td>Positive</td><td>7 October 2024</td></tr>
  <tr><td>Chile</td><td>A2</td><td>Stable</td><td>15 September 2022</td></tr>
  <tr><td>Venezuela</td><td>C</td><td>"Ratings withdrawn"</td><td>9 March 2018</td></tr>
</table>
<div class="mw-heading mw-heading2"><h2>Otra tabla</h2></div>
<table class="wikitable"><tr><th>Foo</th><th>Bar</th></tr><tr><td>1</td><td>2</td></tr></table>
`;

const ad = parseAgencyTables(html);
assert.strictEqual(ad.sp.argentina.rating, 'B-', 'normaliza el menos tipográfico');
assert.strictEqual(ad.sp.brazil.rating, 'BB', 'quita referencias');
assert.strictEqual(ad.sp.argentina.date, '2026-06-10');
assert.strictEqual(ad.fitch.chile.rating, 'A-');
assert.strictEqual(ad.fitch.argentina.outlook, 'Positive');
assert.strictEqual(ad.moodys.argentina.rating, 'Caa1');
assert.ok(!ad.sp.venezuela && ad.moodys.venezuela);

const r = buildRatings(ad);
assert.strictEqual(r.Argentina.sp.score, 16);
assert.strictEqual(r.Argentina.moodys.score, 17);
assert.strictEqual(r.Argentina.fitch.score, 16);
assert.strictEqual(r.Argentina.composite, 'B-');
assert.strictEqual(r.Argentina.group, 'B');
assert.strictEqual(r.Brasil.group, 'BB');
assert.strictEqual(r.Chile.group, 'Grado de inversión');
assert.strictEqual(r.Venezuela.moodys.withdrawn, true, 'retirada -> sin nota');
assert.strictEqual(r.Venezuela.group, 'Sin calificación vigente');
assert.strictEqual(r.Venezuela.score, null);
assert.strictEqual(r.Uruguay.group, 'Sin calificación vigente', 'sin datos -> sin calificación');

// Overrides manuales
const r2 = buildRatings(ad, { Argentina: { moodys: { rating: 'B3', outlook: 'Positive', date: '2026-09-01' } } });
assert.strictEqual(r2.Argentina.moodys.score, 16);
assert.strictEqual(r2.Argentina.score, 16);

// Escalas
assert.strictEqual(ratingScore('sp', 'BBB-'), 10);
assert.strictEqual(ratingScore('moodys', 'Baa3'), 10);
assert.strictEqual(ratingScore('moodys', 'B3'), ratingScore('sp', 'B-'));
assert.strictEqual(ratingScore('fitch', 'RD'), 22);
assert.strictEqual(ratingScore('sp', 'xyz'), null);
assert.strictEqual(groupOf(10), 'Grado de inversión');
assert.strictEqual(groupOf(11), 'BB');
assert.strictEqual(groupOf(17), 'CCC o inferior');
assert.strictEqual(parseDate('June 10, 2026'), '2026-06-10');

console.log('OK: tests de calificaciones pasaron');
