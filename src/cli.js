#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { processCsv } = require('./processor');
const { topByCtr, topByCpa } = require('./ranking');
const { writeRankingCsv } = require('./output');

const USAGE = 'Usage: node src/cli.js --input <path/to/ad_data.csv> --output <directory>';

/** Parses --input and --output from argv. Returns { input, output } or throws. */
function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag !== '--input' && flag !== '--output') {
      throw new Error(`unknown argument "${flag}"`);
    }
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`missing value for ${flag}`);
    }
    options[flag.slice(2)] = value;
  }
  if (!options.input || !options.output) {
    throw new Error('both --input and --output are required');
  }
  return { input: path.resolve(options.input), output: path.resolve(options.output) };
}

function formatElapsed(startedAt) {
  return `${(Number(process.hrtime.bigint() - startedAt) / 1e9).toFixed(2)}s`;
}

async function main() {
  const startedAt = process.hrtime.bigint();
  const { input, output } = parseArgs(process.argv.slice(2));

  const { stats, errorLogPath, campaigns } = await processCsv(input, output);
  const ctrPath = await writeRankingCsv(output, 'top10_ctr.csv', topByCtr(campaigns));
  const cpaPath = await writeRankingCsv(output, 'top10_cpa.csv', topByCpa(campaigns));

  console.log(`Total lines read:   ${stats.totalLines}`);
  console.log(`Valid rows:         ${stats.validRows}`);
  console.log(`Skipped rows:       ${stats.skippedRows}`);
  console.log(`Campaigns:          ${campaigns.length}`);
  console.log(`Error log:          ${errorLogPath}`);
  console.log(`CTR ranking:        ${ctrPath}`);
  console.log(`CPA ranking:        ${cpaPath}`);
  console.log(`Elapsed:            ${formatElapsed(startedAt)}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    if (error.code === 'ENOENT' || error.code === 'EACCES') {
      console.error(`Check that the input file exists and is readable.`);
    }
    if (error.message.startsWith('unknown') || error.message.startsWith('missing') || error.message.startsWith('both')) {
      console.error(USAGE);
    }
    process.exitCode = 1;
  });
}

module.exports = { parseArgs };
