'use strict';

const EXPECTED_COLUMNS = ['campaign_id', 'date', 'impressions', 'clicks', 'spend', 'conversions'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INTEGER_PATTERN = /^\d+$/;
const FLOAT_PATTERN = /^\d+(\.\d+)?$/;

/** Checks the YYYY-MM-DD format and that the date exists (rejects e.g. 2025-13-01). */
function isValidDate(value) {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function isExpectedHeader(line) {
  const columns = line.split(',').map((column) => column.trim());
  return columns.length === EXPECTED_COLUMNS.length
    && columns.every((column, index) => column === EXPECTED_COLUMNS[index]);
}

function parseNonNegativeInteger(raw, name) {
  const value = raw.trim();
  if (!INTEGER_PATTERN.test(value)) {
    return { error: `invalid ${name}="${value}"` };
  }
  return { value: Number(value) };
}

function parseNonNegativeFloat(raw, name) {
  const value = raw.trim();
  if (!FLOAT_PATTERN.test(value)) {
    return { error: `invalid ${name}="${value}"` };
  }
  return { value: Number(value) };
}

/**
 * Parses one data row. Returns { record } on success or { error } on failure.
 * Rows are split on commas; the dataset contains no quoted fields.
 */
function parseRow(line) {
  const fields = line.split(',');
  if (fields.length !== EXPECTED_COLUMNS.length) {
    return { error: `expected ${EXPECTED_COLUMNS.length} columns, found ${fields.length}` };
  }

  const [rawCampaignId, rawDate, rawImpressions, rawClicks, rawSpend, rawConversions] = fields;

  const campaignId = rawCampaignId.trim();
  if (campaignId === '') {
    return { error: 'empty campaign_id' };
  }

  const date = rawDate.trim();
  if (!isValidDate(date)) {
    return { error: `invalid date="${date}"` };
  }

  const impressions = parseNonNegativeInteger(rawImpressions, 'impressions');
  if (impressions.error) return impressions;

  const clicks = parseNonNegativeInteger(rawClicks, 'clicks');
  if (clicks.error) return clicks;

  const spend = parseNonNegativeFloat(rawSpend, 'spend');
  if (spend.error) return spend;

  const conversions = parseNonNegativeInteger(rawConversions, 'conversions');
  if (conversions.error) return conversions;

  return {
    record: {
      campaignId,
      impressions: impressions.value,
      clicks: clicks.value,
      spend: spend.value,
      conversions: conversions.value,
    },
  };
}

module.exports = { isExpectedHeader, parseRow };
