'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { isExpectedHeader } = require('./parser');
const { withMetrics } = require('./aggregator');

const ERROR_LOG_NAME = 'errors.log';
const MAX_RAW_LENGTH = 200;
const MAX_HEADER_BYTES = 64 * 1024;
const NEWLINE = 0x0a;
const SCAN_CHUNK_BYTES = 64 * 1024;
const WORKER_PATH = path.join(__dirname, 'worker.js');

function truncate(text) {
  return text.length > MAX_RAW_LENGTH ? `${text.slice(0, MAX_RAW_LENGTH)}...` : text;
}

function createErrorLog(outputDir) {
  const filePath = path.join(outputDir, ERROR_LOG_NAME);
  const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
  return {
    filePath,
    write(lineNumber, reason, raw) {
      stream.write(`line ${lineNumber} | ${reason} | raw="${truncate(raw)}"\n`);
    },
    close() {
      return new Promise((resolve, reject) => {
        stream.end((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

/** Returns the byte offset just after the first newline at or after position (or the file size). */
async function nextLineStart(handle, position, fileSize) {
  const buffer = Buffer.alloc(SCAN_CHUNK_BYTES);
  let cursor = position;
  while (cursor < fileSize) {
    const { bytesRead } = await handle.read(buffer, 0, SCAN_CHUNK_BYTES, cursor);
    if (bytesRead === 0) break;
    const index = buffer.subarray(0, bytesRead).indexOf(NEWLINE);
    if (index !== -1) return cursor + index + 1;
    cursor += bytesRead;
  }
  return fileSize;
}

/** Reads and checks the header line. Returns the byte offset where the data starts. */
async function readHeader(handle, inputPath, fileSize) {
  const dataStart = await nextLineStart(handle, 0, fileSize);
  if (dataStart > MAX_HEADER_BYTES) {
    throw new Error(`unexpected header in ${inputPath}: header longer than ${MAX_HEADER_BYTES} bytes`);
  }
  const buffer = Buffer.alloc(dataStart);
  if (dataStart > 0) await handle.read(buffer, 0, dataStart, 0);
  const line = buffer.toString('utf8').trim();
  if (!isExpectedHeader(line)) {
    throw new Error(`unexpected header in ${inputPath}: "${truncate(line)}"`);
  }
  return dataStart;
}

/** Splits [dataStart, fileSize) into contiguous ranges whose boundaries are line starts. */
async function splitRanges(handle, dataStart, fileSize, count) {
  const chunkSize = Math.ceil((fileSize - dataStart) / count);
  const boundaries = [dataStart];
  for (let index = 1; index < count; index += 1) {
    boundaries.push(await nextLineStart(handle, dataStart + index * chunkSize, fileSize));
  }
  boundaries.push(fileSize);
  return boundaries.slice(0, -1).map((start, index) => ({ start, end: boundaries[index + 1] }));
}

function runWorker(inputPath, range) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { workerData: { inputPath, ...range } });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`worker exited with code ${code}`));
    });
  });
}

function mergeTotals(merged, campaigns) {
  for (const campaign of campaigns) {
    const total = merged.get(campaign.campaignId) || {
      campaignId: campaign.campaignId,
      impressions: 0,
      clicks: 0,
      spend: 0,
      conversions: 0,
    };
    total.impressions += campaign.impressions;
    total.clicks += campaign.clicks;
    total.spend += campaign.spend;
    total.conversions += campaign.conversions;
    merged.set(campaign.campaignId, total);
  }
}

/**
 * Splits the CSV into byte ranges and aggregates them in parallel worker threads.
 * Line numbers are physical file lines (the header is line 1).
 * Malformed rows are skipped and described in errors.log inside outputDir.
 */
async function processCsv(inputPath, outputDir) {
  await fs.promises.access(inputPath, fs.constants.R_OK);
  await fs.promises.mkdir(outputDir, { recursive: true });

  const handle = await fs.promises.open(inputPath, 'r');
  let partials;
  try {
    const { size } = await handle.stat();
    const dataStart = await readHeader(handle, inputPath, size);
    const workerCount = Math.max(1, os.cpus().length);
    const ranges = await splitRanges(handle, dataStart, size, workerCount);
    partials = await Promise.all(ranges.map((range) => runWorker(inputPath, range)));
  } finally {
    await handle.close();
  }

  const errorLog = createErrorLog(outputDir);
  const stats = { totalLines: 1, validRows: 0, skippedRows: 0 };
  const merged = new Map();
  try {
    for (const partial of partials) {
      for (const error of partial.errors) {
        errorLog.write(stats.totalLines + error.localLine, error.reason, error.raw);
      }
      stats.totalLines += partial.lineCount;
      stats.validRows += partial.validRows;
      stats.skippedRows += partial.errors.length;
      mergeTotals(merged, partial.campaigns);
    }
  } finally {
    await errorLog.close();
  }

  return {
    stats,
    errorLogPath: errorLog.filePath,
    campaigns: [...merged.values()].map(withMetrics),
  };
}

module.exports = { processCsv };
