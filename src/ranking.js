'use strict';

const TOP_N = 10;

/** Compares numbers ascending; null sorts after every number. */
function compareAsc(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function compareDesc(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function compareCampaignIdAsc(a, b) {
  if (a.campaignId < b.campaignId) return -1;
  if (a.campaignId > b.campaignId) return 1;
  return 0;
}

/** Top CTR: CTR desc, CPA desc, campaign_id asc. Campaigns without CTR are excluded. */
function topByCtr(campaigns) {
  return campaigns
    .filter((campaign) => campaign.ctr !== null)
    .sort((a, b) =>
      compareDesc(a.ctr, b.ctr)
      || compareDesc(a.cpa, b.cpa)
      || compareCampaignIdAsc(a, b))
    .slice(0, TOP_N);
}

/** Top CPA: CPA asc, CTR asc, campaign_id asc. Campaigns with zero conversions are excluded. */
function topByCpa(campaigns) {
  return campaigns
    .filter((campaign) => campaign.cpa !== null)
    .sort((a, b) =>
      compareAsc(a.cpa, b.cpa)
      || compareAsc(a.ctr, b.ctr)
      || compareCampaignIdAsc(a, b))
    .slice(0, TOP_N);
}

module.exports = { topByCtr, topByCpa };
