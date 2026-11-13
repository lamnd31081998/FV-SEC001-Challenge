'use strict';

/**
 * Creates an empty aggregator. Totals are stored per campaign_id.
 */
function createAggregator() {
  const campaigns = new Map();

  return {
    add(record) {
      let totals = campaigns.get(record.campaignId);
      if (!totals) {
        totals = { campaignId: record.campaignId, impressions: 0, clicks: 0, spend: 0, conversions: 0 };
        campaigns.set(record.campaignId, totals);
      }
      totals.impressions += record.impressions;
      totals.clicks += record.clicks;
      totals.spend += record.spend;
      totals.conversions += record.conversions;
    },
    campaigns() {
      return Array.from(campaigns.values(), withMetrics);
    },
  };
}

/**
 * CTR = clicks / impressions (null when impressions = 0).
 * CPA = spend / conversions (null when conversions = 0).
 */
function withMetrics(totals) {
  return {
    ...totals,
    ctr: totals.impressions === 0 ? null : totals.clicks / totals.impressions,
    cpa: totals.conversions === 0 ? null : totals.spend / totals.conversions,
  };
}

module.exports = { createAggregator, withMetrics };
