'use strict';

/**
 * Recomputes the rankings from inputs/ad_data.csv with independent code
 * (no shared logic with src/) and compares them with results/*.csv.
 * Slow on the full dataset (parallel read, ~2-3 s), so it is skipped unless inputs/ad_data.csv and results/ exist.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const ROOT = path.join(__dirname, '..');
const INPUT = path.join(ROOT, 'inputs', 'ad_data.csv');
const RESULTS = path.join(ROOT, 'results');
const MIN_REAL_SIZE_BYTES = 1024 * 1024;
const TIMEOUT_MS = 10 * 60 * 1000;

function inputSkipReason() {
  if (!fs.existsSync(INPUT)) return `${INPUT} not found`;
  if (fs.statSync(INPUT).size < MIN_REAL_SIZE_BYTES) return 'input is a Git LFS pointer, not the real file';
  if (!fs.existsSync(path.join(RESULTS, 'top10_ctr.csv')) || !fs.existsSync(path.join(RESULTS, 'top10_cpa.csv'))) {
    return 'results/ has not been generated yet';
  }
  return false;
}

const NEWLINE = 10;
const COMMA = 44;
const CARRIAGE_RETURN = 13;

function parseDigits(buf, from, to) {
  let value = 0;
  for (let i = from; i < to; i += 1) value = value * 10 + (buf[i] - 48);
  return value;
}

function addLine(totals, rawLine) {
  const line = rawLine[rawLine.length - 1] === CARRIAGE_RETURN ? rawLine.subarray(0, -1) : rawLine;
  if (line.length === 0) return;
  const c1 = line.indexOf(COMMA);
  const c2 = line.indexOf(COMMA, c1 + 1);
  const c3 = line.indexOf(COMMA, c2 + 1);
  const c4 = line.indexOf(COMMA, c3 + 1);
  const c5 = line.indexOf(COMMA, c4 + 1);
  const campaignId = line.toString('latin1', 0, c1);
  let total = totals.get(campaignId);
  if (!total) {
    total = { impressions: 0, clicks: 0, spend: 0, conversions: 0 };
    totals.set(campaignId, total);
  }
  total.impressions += parseDigits(line, c2 + 1, c3);
  total.clicks += parseDigits(line, c3 + 1, c4);
  total.spend += Number(line.toString('latin1', c4 + 1, c5));
  total.conversions += parseDigits(line, c5 + 1, line.length);
}

/**
 * Aggregates the lines whose first byte lies in [start, end).
 * The first line in each range is skipped: the header when start is 0,
 * otherwise the partial line that belongs to the previous range.
 */
async function aggregateRange(filePath, start, end) {
  const totals = new Map();
  const from = start > 0 ? start - 1 : 0;
  let skipFirst = true;
  let lineStart = from;
  let carry = Buffer.alloc(0);
  for await (const chunk of fs.createReadStream(filePath, { start: from })) {
    const buf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
    let pos = 0;
    let newline = buf.indexOf(NEWLINE, pos);
    while (newline !== -1) {
      if (lineStart + pos >= end) return totals;
      if (skipFirst) skipFirst = false;
      else addLine(totals, buf.subarray(pos, newline));
      pos = newline + 1;
      newline = buf.indexOf(NEWLINE, pos);
    }
    lineStart += pos;
    carry = Buffer.from(buf.subarray(pos));
  }
  if (!skipFirst && carry.length > 0 && lineStart < end) addLine(totals, carry);
  return totals;
}

function runWorker(filePath, start, end) {
  const source = `
    const { parentPort, workerData } = require('node:worker_threads');
    const fs = require('node:fs');
    const NEWLINE = ${NEWLINE};
    const COMMA = ${COMMA};
    const CARRIAGE_RETURN = ${CARRIAGE_RETURN};
    ${parseDigits}
    ${addLine}
    ${aggregateRange}
    const { filePath, start, end } = workerData;
    aggregateRange(filePath, start, end).then((totals) => parentPort.postMessage([...totals]));
  `;
  return new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, workerData: { filePath, start, end } });
    worker.once('message', resolve);
    worker.once('error', reject);
  });
}

async function computeTotals(filePath) {
  const { size } = await fs.promises.stat(filePath);
  const workers = Math.max(1, os.cpus().length);
  const chunkSize = Math.ceil(size / workers);
  const partials = await Promise.all(Array.from({ length: workers }, (_, index) =>
    runWorker(filePath, index * chunkSize, Math.min(size, (index + 1) * chunkSize))));

  const merged = new Map();
  for (const entries of partials) {
    for (const [campaignId, partial] of entries) {
      const total = merged.get(campaignId) || { impressions: 0, clicks: 0, spend: 0, conversions: 0 };
      total.impressions += partial.impressions;
      total.clicks += partial.clicks;
      total.spend += partial.spend;
      total.conversions += partial.conversions;
      merged.set(campaignId, total);
    }
  }
  return [...merged].map(([campaignId, total]) => ({
    campaignId,
    ...total,
    ctr: total.clicks / total.impressions,
    cpa: total.conversions === 0 ? null : total.spend / total.conversions,
  }));
}


function compareNullable(a, b, direction) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction * (a - b);
}

function byId(a, b) {
  return a.campaignId < b.campaignId ? -1 : a.campaignId > b.campaignId ? 1 : 0;
}

function expectedTopCtr(campaigns) {
  return [...campaigns]
    .sort((a, b) => compareNullable(a.ctr, b.ctr, -1)
      || compareNullable(a.cpa, b.cpa, -1)
      || byId(a, b))
    .slice(0, 10);
}

function expectedTopCpa(campaigns) {
  return campaigns
    .filter((campaign) => campaign.cpa !== null)
    .sort((a, b) => compareNullable(a.cpa, b.cpa, 1)
      || compareNullable(a.ctr, b.ctr, 1)
      || byId(a, b))
    .slice(0, 10);
}

function toExpectedLine(campaign) {
  return [
    campaign.campaignId,
    campaign.impressions,
    campaign.clicks,
    campaign.spend.toFixed(2),
    campaign.conversions,
    campaign.ctr.toFixed(4),
    campaign.cpa === null ? 'null' : campaign.cpa.toFixed(2),
  ].join(',');
}

function readResultLines(fileName) {
  return fs.readFileSync(path.join(RESULTS, fileName), 'utf8').trimEnd().split('\n');
}

const skipReason = inputSkipReason();
const HEADER = 'campaign_id,total_impressions,total_clicks,total_spend,total_conversions,CTR,CPA';

let campaignsPromise = null;
function loadCampaigns() {
  campaignsPromise ??= computeTotals(INPUT);
  return campaignsPromise;
}

test('campaign count from the dataset is 50', { skip: skipReason, timeout: TIMEOUT_MS }, async () => {
  const campaigns = await loadCampaigns();
  assert.equal(campaigns.length, 50);
});

test('top10_ctr.csv matches the CTR ranking recomputed from the dataset', { skip: skipReason, timeout: TIMEOUT_MS }, async () => {
  const expected = [HEADER, ...expectedTopCtr(await loadCampaigns()).map(toExpectedLine)];
  assert.deepEqual(readResultLines('top10_ctr.csv'), expected);
});

test('top10_cpa.csv matches the CPA ranking recomputed from the dataset', { skip: skipReason, timeout: TIMEOUT_MS }, async () => {
  const expected = [HEADER, ...expectedTopCpa(await loadCampaigns()).map(toExpectedLine)];
  assert.deepEqual(readResultLines('top10_cpa.csv'), expected);
});
