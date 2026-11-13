'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const CSV_HEADER = 'campaign_id,total_impressions,total_clicks,total_spend,total_conversions,CTR,CPA';

function formatCtr(ctr) {
  return ctr === null ? 'null' : ctr.toFixed(4);
}

function formatCpa(cpa) {
  return cpa === null ? 'null' : cpa.toFixed(2);
}

function toCsvLine(campaign) {
  return [
    campaign.campaignId,
    campaign.impressions,
    campaign.clicks,
    campaign.spend.toFixed(2),
    campaign.conversions,
    formatCtr(campaign.ctr),
    formatCpa(campaign.cpa),
  ].join(',');
}

/** Writes a ranked list as CSV, creating the output directory if needed. */
async function writeRankingCsv(outputDir, fileName, campaigns) {
  await fs.mkdir(outputDir, { recursive: true });
  const lines = [CSV_HEADER, ...campaigns.map(toCsvLine)];
  const filePath = path.join(outputDir, fileName);
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

module.exports = { toCsvLine, writeRankingCsv };
