'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRow, isExpectedHeader } = require('../src/parser');
const { createAggregator, withMetrics } = require('../src/aggregator');
const { topByCtr, topByCpa } = require('../src/ranking');
const { toCsvLine } = require('../src/output');
const { parseArgs } = require('../src/cli');

test('parseRow accepts a valid row', () => {
  const result = parseRow('CMP001,2025-01-01,12000,300,45.50,12');
  assert.deepEqual(result.record, {
    campaignId: 'CMP001',
    impressions: 12000,
    clicks: 300,
    spend: 45.5,
    conversions: 12,
  });
});

test('parseRow rejects malformed rows with a reason', () => {
  assert.match(parseRow('CMP001,2025-01-01,12000,300,45.50').error, /expected 6 columns/);
  assert.match(parseRow('CMP001,2025-01-01,abc,300,45.50,12').error, /invalid impressions/);
  assert.match(parseRow('CMP001,2025-01-01,1,1,-2.00,1').error, /invalid spend/);
  assert.match(parseRow('CMP001,2025/01/01,1,1,2.00,1').error, /invalid date/);
  assert.match(parseRow(',2025-01-01,1,1,2.00,1').error, /empty campaign_id/);
});

test('isExpectedHeader matches the required schema only', () => {
  assert.equal(isExpectedHeader('campaign_id,date,impressions,clicks,spend,conversions'), true);
  assert.equal(isExpectedHeader('campaign_id,date,impressions'), false);
});

test('aggregator sums totals per campaign_id and computes CTR and CPA', () => {
  const aggregator = createAggregator();
  aggregator.add({ campaignId: 'A', impressions: 1000, clicks: 100, spend: 50, conversions: 10 });
  aggregator.add({ campaignId: 'A', impressions: 1000, clicks: 50, spend: 30, conversions: 5 });
  aggregator.add({ campaignId: 'B', impressions: 10, clicks: 0, spend: 4, conversions: 0 });

  const byId = Object.fromEntries(aggregator.campaigns().map((campaign) => [campaign.campaignId, campaign]));
  assert.equal(byId.A.impressions, 2000);
  assert.equal(byId.A.clicks, 150);
  assert.equal(byId.A.spend, 80);
  assert.equal(byId.A.conversions, 15);
  assert.equal(byId.A.ctr, 0.075);
  assert.ok(Math.abs(byId.A.cpa - 80 / 15) < 1e-12);
  assert.equal(byId.B.cpa, null);
});

test('withMetrics returns null CTR when impressions are zero', () => {
  const metrics = withMetrics({ campaignId: 'Z', impressions: 0, clicks: 0, spend: 0, conversions: 0 });
  assert.equal(metrics.ctr, null);
  assert.equal(metrics.cpa, null);
});

test('topByCtr sorts by CTR desc, CPA desc, campaign_id asc', () => {
  const campaigns = [
    withMetrics({ campaignId: 'B', impressions: 100, clicks: 10, spend: 10, conversions: 1 }),
    withMetrics({ campaignId: 'A', impressions: 100, clicks: 10, spend: 20, conversions: 1 }),
    withMetrics({ campaignId: 'C', impressions: 100, clicks: 10, spend: 10, conversions: 1 }),
    withMetrics({ campaignId: 'D', impressions: 100, clicks: 20, spend: 1, conversions: 1 }),
  ];
  assert.deepEqual(topByCtr(campaigns).map((c) => c.campaignId), ['D', 'A', 'B', 'C']);
});

test('topByCpa excludes zero-conversion campaigns and sorts by CPA asc, CTR asc, campaign_id asc', () => {
  const campaigns = [
    withMetrics({ campaignId: 'Z', impressions: 100, clicks: 1, spend: 1, conversions: 0 }),
    withMetrics({ campaignId: 'B', impressions: 100, clicks: 10, spend: 10, conversions: 1 }),
    withMetrics({ campaignId: 'A', impressions: 100, clicks: 5, spend: 10, conversions: 1 }),
    withMetrics({ campaignId: 'C', impressions: 100, clicks: 5, spend: 5, conversions: 1 }),
  ];
  assert.deepEqual(topByCpa(campaigns).map((c) => c.campaignId), ['C', 'A', 'B']);
});

test('rankings return at most 10 campaigns', () => {
  const campaigns = Array.from({ length: 15 }, (_, index) =>
    withMetrics({ campaignId: `C${index}`, impressions: 100, clicks: index + 1, spend: 10, conversions: 1 }));
  assert.equal(topByCtr(campaigns).length, 10);
  assert.equal(topByCpa(campaigns).length, 10);
});

test('toCsvLine formats CTR with 4 decimals, CPA with 2 decimals and null for zero conversions', () => {
  const campaign = withMetrics({ campaignId: 'X', impressions: 3, clicks: 1, spend: 10, conversions: 0 });
  assert.equal(toCsvLine(campaign), 'X,3,1,10.00,0,0.3333,null');
});

test('parseArgs requires --input and --output', () => {
  assert.throws(() => parseArgs(['--input', 'a.csv']), /both --input and --output/);
  assert.throws(() => parseArgs(['--input']), /missing value/);
  assert.throws(() => parseArgs(['--foo', 'x']), /unknown argument/);
  const parsed = parseArgs(['--input', 'a.csv', '--output', 'out']);
  assert.ok(parsed.input.endsWith('a.csv'));
  assert.ok(parsed.output.endsWith('out'));
});
