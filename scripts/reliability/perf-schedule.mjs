// SPDX-License-Identifier: MIT OR Apache-2.0
// Pure schedule construction/validation. No clock reads, files or capture calls.
const FORMAT = 'editor-reliability-capture-schedule/1';
const PHASES = ['timing', 'allocator'];
// Test-evidence integrity bounds, not permission to perform additional captures.
export const SCHEDULE_LIMITS = Object.freeze({ launchEntries: 16384, metricRows: 65536 });
const require = (condition, message) => { if (!condition) throw new Error(message); };
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function fields(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!required.every(key => Object.hasOwn(value, key))) return false;
  let count = 0;
  for (const key in value) if (Object.hasOwn(value, key)) {
    if (++count > required.length + optional.length || (!required.includes(key) && !optional.includes(key))) return false;
  }
  return true;
}
function product(factors, limit, message) {
  let value = 1;
  for (const factor of factors) {
    require(Number.isSafeInteger(factor) && factor > 0 && value <= Math.floor(limit / factor), message);
    value *= factor;
  }
  return value;
}
function dimensions(items, rounds, mode) {
  require(['calibration', 'comparison'].includes(mode), 'invalid schedule mode');
  require(Number.isSafeInteger(rounds) && rounds >= 5, 'invalid schedule rounds');
  require(Array.isArray(items) && items.length > 0, 'missing schedule items');
  const sides = mode === 'calibration' ? 1 : 2;
  // Check products before visiting catalog entries, creating sets, or cloning arrays.
  const repetitions = product([rounds, sides], SCHEDULE_LIMITS.launchEntries, 'schedule launch budget exceeded');
  const launchEntries = product([repetitions, items.length], SCHEDULE_LIMITS.launchEntries, 'schedule launch budget exceeded');
  const maximumCases = Math.floor(SCHEDULE_LIMITS.metricRows / repetitions);
  let caseCount = 0;
  for (const item of items) {
    require(fields(item, ['cases', 'id', 'phase']), 'invalid schedule item fields');
    require(PHASES.includes(item.phase) && Array.isArray(item.cases) && item.cases.length > 0, 'invalid schedule item phase/cases');
    require(item.cases.length <= maximumCases - caseCount, 'schedule metric budget exceeded');
    caseCount += item.cases.length;
  }
  return { sides, launchEntries, metricRows: product([repetitions, caseCount], SCHEDULE_LIMITS.metricRows, 'schedule metric budget exceeded') };
}
function catalog(items, rounds, mode) {
  const counts = dimensions(items, rounds, mode);
  const ids = new Set(), cases = new Set();
  for (const item of items) {
    require(typeof item.id === 'string' && item.id.length > 0 && !ids.has(item.id), 'duplicate/invalid schedule item'); ids.add(item.id);
    for (const id of item.cases) { require(typeof id === 'string' && id.length > 0 && !cases.has(id), 'duplicate/invalid scheduled metric'); cases.add(id); }
  }
  return counts;
}
function descriptor(schedule) {
  require(fields(schedule, ['format', 'items', 'mode', 'phaseOrder', 'rounds'], ['sha256']), 'invalid schedule descriptor fields');
  require(schedule.format === FORMAT && Array.isArray(schedule.phaseOrder) && schedule.phaseOrder.length === 2
    && schedule.phaseOrder[0] === PHASES[0] && schedule.phaseOrder[1] === PHASES[1], 'unsupported schedule phase order');
  return catalog(schedule.items, schedule.rounds, schedule.mode);
}
export function catalogForPlan(plan) {
  require(Array.isArray(plan) && plan.length > 0, 'missing schedule plan');
  // Every usable descriptor has at least five rounds and one side. Reject an
  // impossible input length before map/template copies or visiting its items.
  product([5, plan.length], SCHEDULE_LIMITS.launchEntries, 'schedule launch budget exceeded');
  let caseCount = 0;
  for (const item of plan) {
    require(item && typeof item.id === 'string' && item.id.length > 0, 'invalid schedule plan item');
    require(['core', 'native-bridge', 'wasm-bridge', 'sdk', 'allocator'].includes(item.layer), 'unknown schedule layer');
    const count = item.layer === 'allocator' ? 3 : ['wasm-bridge', 'sdk'].includes(item.layer) ? 4 : 1;
    require(count <= Math.floor(SCHEDULE_LIMITS.metricRows / 5) - caseCount, 'schedule metric budget exceeded');
    caseCount += count;
  }
  return plan.map(item => {
    const suffixes = item.layer === 'allocator' ? ['allocated', 'live', 'whole-process-peak']
      : ['wasm-bridge', 'sdk'].includes(item.layer) ? ['latency', 'wasm-capacity', 'sampled-process-rss', 'cold-startup'] : ['latency'];
    return { id: item.id, phase: item.layer === 'allocator' ? 'allocator' : 'timing', cases: suffixes.map(suffix => `${item.id}/${suffix}`) };
  });
}
export function makeSchedule(items, rounds, mode) {
  catalog(items, rounds, mode); // All counts/products checked before any catalog clone.
  return { format: FORMAT, phaseOrder: [...PHASES], mode, rounds,
    items: items.map(item => ({ id: item.id, phase: item.phase, cases: [...item.cases] })) };
}
export function scheduleEntries(schedule) {
  descriptor(schedule); // Finite entry/metric bounds checked before materializing.
  const entries = [];
  for (const phase of PHASES) for (let round = 0; round < schedule.rounds; round++) {
    const sides = schedule.mode === 'calibration' ? ['baseline'] : round % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    for (const item of schedule.items) if (item.phase === phase) for (const side of sides)
      entries.push({ index: entries.length, phase, round, item: item.id, side });
  }
  return entries;
}
export function validateSchedule(schedule, launches, runs, { side } = {}) {
  require(typeof schedule?.sha256 === 'string' && /^[a-f0-9]{64}$/.test(schedule.sha256), 'missing sealed schedule identity');
  require(side === undefined || ['baseline', 'candidate'].includes(side), 'invalid schedule side');
  require(Array.isArray(launches), 'schedule launch count mismatch');
  require(launches.length <= SCHEDULE_LIMITS.launchEntries, 'schedule launch budget exceeded');
  require(Array.isArray(runs), 'missing scheduled metric runs');
  require(runs.length <= SCHEDULE_LIMITS.metricRows, 'schedule metric budget exceeded');
  const counts = descriptor(schedule);
  const expectedCount = side === undefined ? counts.launchEntries : side === 'candidate' && schedule.mode === 'calibration' ? 0 : counts.launchEntries / counts.sides;
  require(expectedCount > 0, 'schedule side has no entries');
  require(launches.length === expectedCount, 'schedule launch count mismatch');
  const entries = scheduleEntries(schedule), expected = side === undefined ? entries : entries.filter(entry => entry.side === side);
  const items = new Map(schedule.items.map(item => [item.id, item])), ids = new Set(), byLaunch = new Map();
  for (const run of runs) { const grouped = byLaunch.get(run.launchId) ?? []; grouped.push(run); byLaunch.set(run.launchId, grouped); }
  let previousEnd = -Infinity, metricCount = 0;
  for (const [position, launch] of launches.entries()) {
    const entry = expected[position], item = items.get(entry.item);
    require(typeof launch.id === 'string' && !ids.has(launch.id), 'duplicate/invalid scheduled launch'); ids.add(launch.id);
    require(launch.scheduleSha256 === schedule.sha256 && launch.scheduleIndex === entry.index
      && launch.phase === entry.phase && launch.planItem === entry.item && launch.round === entry.round && launch.side === entry.side,
    'schedule launch binding/order mismatch');
    const start = Date.parse(launch.startedAt), end = Date.parse(launch.completedAt);
    require(Number.isFinite(start) && Number.isFinite(end) && start < end && start >= previousEnd, 'schedule chronological order mismatch'); previousEnd = end;
    require(equal(launch.cases, item.cases), 'scheduled launch metric catalog mismatch');
    const actual = byLaunch.get(launch.id) ?? [], actualIds = new Set(actual.map(run => run.case));
    require(actual.length === item.cases.length && actualIds.size === item.cases.length
      && item.cases.every(id => actualIds.has(id)), 'scheduled metric coverage mismatch');
    require(actual.every(run => run.round === entry.round && run.phase === entry.phase && run.scheduleIndex === entry.index), 'scheduled metric phase binding mismatch');
    metricCount += actual.length;
  }
  require(metricCount === runs.length && [...byLaunch.keys()].every(id => ids.has(id)), 'orphan scheduled metric run');
  return true;
}
