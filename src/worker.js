'use strict';

const fs = require('node:fs');
const { isMainThread, parentPort, workerData } = require('node:worker_threads');
const { parseRow } = require('./parser');
const { createAggregator } = require('./aggregator');

const NEWLINE = 0x0a;

function stripTrailingCarriageReturn(text) {
  return text.endsWith('\r') ? text.slice(0, -1) : text;
}

/**
 * Aggregates the lines in the byte range [start, end) of the file.
 * Ranges start and end right after a newline (or at end of file), so every line
 * is read by exactly one worker. Line numbers are relative to the start of the range.
 */
async function aggregateRange(inputPath, start, end) {
  const aggregator = createAggregator();
  const errors = [];
  let lineCount = 0;
  let validRows = 0;

  const handleLine = (bytes) => {
    lineCount += 1;
    const raw = stripTrailingCarriageReturn(bytes.toString('utf8'));
    const line = raw.trim();
    if (line === '') {
      errors.push({ localLine: lineCount, reason: 'empty line', raw });
      return;
    }
    const result = parseRow(line);
    if (result.error) {
      errors.push({ localLine: lineCount, reason: result.error, raw });
      return;
    }
    validRows += 1;
    aggregator.add(result.record);
  };

  if (end > start) {
    let carry = Buffer.alloc(0);
    for await (const chunk of fs.createReadStream(inputPath, { start, end: end - 1 })) {
      const buffer = carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
      let lineStart = 0;
      let newline = buffer.indexOf(NEWLINE, lineStart);
      while (newline !== -1) {
        handleLine(buffer.subarray(lineStart, newline));
        lineStart = newline + 1;
        newline = buffer.indexOf(NEWLINE, lineStart);
      }
      carry = Buffer.from(buffer.subarray(lineStart));
    }
    if (carry.length > 0) {
      handleLine(carry);
    }
  }

  return { lineCount, validRows, errors, campaigns: aggregator.campaigns() };
}

if (!isMainThread) {
  const { inputPath, start, end } = workerData;
  aggregateRange(inputPath, start, end).then((result) => parentPort.postMessage(result));
}

