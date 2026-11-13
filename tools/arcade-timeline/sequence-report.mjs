import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { PNG } from 'pngjs';
import { compareImages } from './visual-compare.mjs';

const statuses = ['pass', 'fail', 'unavailable', 'incomplete'];
const empty = () => ({ required: 0, captured: 0, compared: 0, passed: 0, failed: 0, unavailable: 0, incomplete: 0 });
function count(items) {
  const counts = empty();
  for (const item of items) {
    counts.required++;
    counts.captured += Number(item.captured === true);
    counts.compared += Number(item.compared === true);
    counts[{ pass: 'passed', fail: 'failed', unavailable: 'unavailable', incomplete: 'incomplete' }[item.status]]++;
  }
  return counts;
}
function statusOf(points) {
  return points.some(p => p.status === 'fail') ? 'fail'
    : points.some(p => p.status === 'unavailable') ? 'unavailable'
      : points.length && points.every(p => p.status === 'pass') ? 'pass' : 'incomplete';
}
function normalize(point, category) {
  if (!point) return { captured: false, compared: false, status: 'incomplete', reason: 'Required checkpoint has no result' };
  const captured = point.captured === true;
  const compared = point.compared === true && ['pass', 'fail'].includes(point.status);
  const status = statuses.includes(point.status) ? point.status : 'incomplete';
  if (['pass', 'fail'].includes(status) && (!compared || (category !== 'live' && !captured))) {
    return { captured, compared: false, status: 'incomplete', reason: 'No established capture/comparison evidence', reportedStatus: point.status };
  }
  return { captured, compared, status, reason: point.reason };
}

/** Counts inventory checkpoints, never returned array lengths. Producers must
 * explicitly establish captured/compared; status strings and contract validation
 * alone are not pixel comparisons. `groups` uses the same fields per definition.
 * Identical duplicates are deduplicated; conflicting duplicates are incomplete.
 */
export function summarizeCoverage(definitions, results) {
  const ids = new Set(), byId = new Map(), issues = [];
  for (const d of definitions) {
    if (ids.has(d.id) || new Set(d.checkpoints.map(p => p.id)).size !== d.checkpoints.length) throw Error('Duplicate inventory ID');
    ids.add(d.id);
  }
  for (const r of results) {
    const d = definitions.find(d => d.id === r.checkId);
    if (!d || r.category !== d.category) {
      issues.push({ checkId: r.checkId, reason: d ? 'Result category differs from inventory' : 'Result outside inventory' }); continue;
    }
    if (!byId.has(d.id)) byId.set(d.id, []);
    if (!byId.get(d.id).some(other => isDeepStrictEqual(other, r))) byId.get(d.id).push(r);
  }
  const entries = definitions.map(d => {
    const rows = byId.get(d.id) ?? [];
    const checkpoints = d.checkpoints.map(p => {
      const candidates = rows.flatMap(r => r.checkpoints ?? []).filter(c => c.id === p.id);
      const unique = candidates.filter((c, i) => !candidates.slice(0, i).some(other => isDeepStrictEqual(other, c)));
      if (unique.length > 1) {
        issues.push({ checkId: d.id, checkpoint: p.id, reason: 'Conflicting duplicate checkpoint results' });
        return { id: p.id, captured: unique.some(c => c.captured === true), compared: false, status: 'incomplete', reason: 'Conflicting duplicate checkpoint results' };
      }
      return { id: p.id, ...normalize(unique[0], d.category) };
    });
    for (const r of rows) for (const p of r.checkpoints ?? []) if (!d.checkpoints.some(c => c.id === p.id)) issues.push({ checkId: d.id, checkpoint: p.id, reason: 'Checkpoint outside inventory' });
    let status = statusOf(checkpoints);
    if (rows.some(r => r.status === 'fail')) status = 'fail';
    else if (status === 'pass' && rows.some(r => ['unavailable', 'incomplete'].includes(r.status) || r.errors?.length || r.issues?.length)) status = rows.some(r => r.status === 'unavailable') ? 'unavailable' : 'incomplete';
    return { checkId: d.id, category: d.category, status, captured: checkpoints.some(p => p.captured), compared: checkpoints.length > 0 && checkpoints.every(p => p.compared), checkpoints };
  });
  const categories = {}, groups = {};
  for (const category of new Set(definitions.map(d => d.category))) {
    const selected = entries.filter(e => e.category === category);
    categories[category] = count(selected.flatMap(e => e.checkpoints)); groups[category] = count(selected);
  }
  return { categories, groups, complete: entries.every(e => ['pass','fail'].includes(e.status)) && !issues.length,
    passed: entries.length > 0 && entries.every(e => e.status === 'pass') && !issues.length, entries, issues };
}

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
function links(value, root, outDir, label = 'evidence', found = []) {
  if (typeof value === 'string' && /\.(png|json|md|log|html)$/.test(value) && !/^[a-z]+:/i.test(value)) {
    const target = path.resolve(root, value);
    found.push({ label, href: path.relative(outDir, target).split(path.sep).map(encodeURIComponent).join('/'), exists: fs.existsSync(target) });
  } else if (Array.isArray(value)) value.forEach((v, i) => links(v, root, outDir, `${label} ${i + 1}`, found));
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) links(child, root, outDir, key, found);
  return found;
}
function table(categories, title) {
  return `<h2>${title}</h2><table><tr><th>Category</th>${Object.keys(empty()).map(k => `<th>${k}</th>`).join('')}</tr>${Object.entries(categories).map(([name,c]) => `<tr><th>${escape(name)}</th>${Object.values(c).map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}</table>`;
}

function deriveArtworkDifferences(results, outDir) {
  return results.map(check => check.category !== 'artwork' ? check : { ...check, checkpoints: check.checkpoints.map(p => {
    if (p.status !== 'fail') return p;
    const pairs = [];
    for (const file of new Set(Array.isArray(p.evidence) ? p.evidence : [])) {
      if (!file.endsWith('-actual.png')) continue;
      const current = path.resolve(check.evidenceRoot ?? outDir, file), reference = current.replace(/-actual\.png$/, '-reference.png');
      if (!fs.existsSync(reference) || !fs.existsSync(current)) continue;
      try {
        const { difference, ...measurement } = compareImages(PNG.sync.read(fs.readFileSync(reference)), PNG.sync.read(fs.readFileSync(current)));
        const folder = path.join(outDir, 'derived-artifacts'); fs.mkdirSync(folder, { recursive: true });
        const target = path.join(folder, `${check.checkId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${p.id}-${pairs.length}-difference.png`);
        fs.writeFileSync(target, PNG.sync.write(difference));
        pairs.push({ reference, current, difference: target, measurement, provenance: 'Report-derived exact RGBA difference of retained independent reference/current crops; source artifacts unchanged' });
      } catch (error) { pairs.push({ reference, current, differenceUnavailable: error.message }); }
    }
    return { ...p, artifacts: { ...p.artifacts, sourcePairs: pairs } };
  }) });
}

/** Static review artifact. Raw producer results/measurements remain in JSON;
 * reporting never changes reference pixels, thresholds or original artifacts.
 * requestedCategories scopes the exit decision while all inventory stays visible.
 */
export function writeSequenceReport({ definitions, results, outDir, requestedCategories, producerErrors = [], provenance = {} }) {
  outDir = path.resolve(outDir); fs.mkdirSync(outDir, { recursive: true });
  results = deriveArtworkDifferences(results, outDir);
  const coverage = summarizeCoverage(definitions, results);
  const requested = definitions.filter(d => !requestedCategories || requestedCategories.includes(d.category));
  const requestedIds = new Set(requested.map(d => d.id));
  const requestedCoverage = summarizeCoverage(requested, results.filter(r => requestedIds.has(r.checkId)));
  // Unknown results and category mismatches remain integrity failures, even when
  // they cannot contribute a row to the requested denominator.
  const report = { version: 1, generatedAt: new Date().toISOString(), provenance,
    requestedCategories: [...new Set(requested.map(d => d.category))], definitions, results, producerErrors, coverage, requestedCoverage,
    complete: requestedCoverage.complete && !producerErrors.length && !coverage.issues.length,
    passed: requestedCoverage.passed && !producerErrors.length && !coverage.issues.length };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const details = coverage.entries.map(entry => {
    const source = results.filter(r => r.checkId === entry.checkId);
    const root = source[0]?.evidenceRoot ?? outDir;
    const artifacts = links(source, root, outDir);
    const unique = artifacts.filter((a, i) => artifacts.findIndex(b => b.href === a.href) === i);
    return `<details${entry.status === 'pass' ? '' : ' open'}><summary>${escape(entry.checkId)} — ${entry.status}${requestedIds.has(entry.checkId) ? '' : ' (not requested)'}</summary><ul>${entry.checkpoints.map(p => `<li>${escape(p.id)}: <b>${p.status}</b> — ${escape(p.reason ?? '')}</li>`).join('')}</ul><p>${unique.map(a => `<a href="${escape(a.href)}">${escape(a.label)}${a.exists ? '' : ' (missing)'}</a>`).join(' · ')}</p><details><summary>Raw results and measurements</summary><pre>${escape(JSON.stringify(source, null, 2))}</pre></details></details>`;
  }).join('\n');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Sequence validation</title><style>body{font:15px system-ui;max-width:1200px;margin:2em auto;padding:1em}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:.4em}details{margin:1em 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}summary{font-weight:bold}</style><h1>Sequence validation: ${report.passed ? 'PASS' : 'NON-PASS'}</h1><p>Requested categories: ${escape(report.requestedCategories.join(', '))}. Complete: ${report.complete}. Full inventory passed: ${coverage.passed}. Unrequested categories remain visible and do not affect the requested outcome. Artwork, live and compositing never satisfy full-screen fidelity.</p><p><a href="report.json">JSON report with raw measurements</a></p>${table(coverage.categories, 'Checkpoint accounting (entire scope)')}${table(coverage.groups, 'Grouped accounting (entire scope)')}<h2>Producer errors and integrity issues</h2><pre>${escape(JSON.stringify([...producerErrors, ...coverage.issues], null, 2))}</pre><h2>Required checks, including incomplete entries</h2>${details}</html>`;
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  return report;
}
