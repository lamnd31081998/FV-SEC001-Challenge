# FV-SEC001-Challenge

Node.js CLI that aggregates advertising performance data (`ad_data.csv`, ~1 GB) by `campaign_id` and writes the top 10 campaigns by CTR and by CPA.

## Setup

Requirements: Node.js 26 or newer. No third-party dependencies are needed.

```bash
git clone <repository-url>
cd FV-SEC001-Challenge
unzip ad_data.csv.zip && mkdir -p inputs && mv ad_data.csv inputs/   # produces inputs/ad_data.csv
```

## How to run

```bash
node src/cli.js --input inputs/ad_data.csv --output results/
```

Or via npm:

```bash
npm start -- --input inputs/ad_data.csv --output results/
```

### With Docker

Requirements: Docker. The image is based on `node:26-slim`.

```bash
docker build -t ad-aggregator .
docker run --rm -v "$(pwd)":/data ad-aggregator --input /data/inputs/ad_data.csv --output /data/results/
```

The current directory is mounted at `/data`, so the input file is read from it and the results are written to `results/` on the host. Paths inside the container must use `/data/...`.

Outputs written to the `--output` directory (created if missing):

- `top10_ctr.csv`: top 10 campaigns by CTR.
- `top10_cpa.csv`: top 10 campaigns by lowest CPA (campaigns with zero conversions excluded).
- `errors.log`: one line per skipped row, with line number, reason and raw content (truncated to 200 characters).

Run tests:

```bash
npm test
```

`npm test` runs two groups of tests:

- **Unit tests** in `tests/aggregator.test.js`: row parsing, header check, aggregation, ranking, CSV formatting and argument parsing, on small hand-written inputs.
- **Reconciliation tests** in `tests/rankings.test.js`: recompute the campaign count and both top 10 lists from `inputs/ad_data.csv` (about 3 seconds) and compare them with `results/top10_ctr.csv` and `results/top10_cpa.csv`. They are skipped if the input is missing, is only a Git LFS pointer, or `results/` has not been generated yet.

The reconciliation test has its own byte-range reader, separate from `src/`, and its own ranking code. This is intentional: if it reused `src/`, a bug in the shared code would appear in both the output and the expected values and would not be detected. The two readers must still agree on the data, which is what the test checks.


## Libraries used

- Node.js built-in modules only: `node:fs`, `node:os`, `node:path`, `node:worker_threads`, `node:test`, `node:assert`.

## Method and decisions

- **Streaming:** the file is split into byte ranges, one per CPU core (`os.cpus().length`). Each range is read by a `worker_threads` worker in `src/worker.js` in fixed-size chunks, so the whole file is never loaded into memory. Each range starts and ends on a line boundary, so every line is read by exactly one worker. Only one aggregate entry per `campaign_id` is kept per worker, and the partial totals are merged in the main thread.
- **Metrics:** `CTR = total_clicks / total_impressions`; `CPA = total_spend / total_conversions`, written as `null` when conversions are 0.
- **Sorting:**
  - Top CTR: CTR desc, then CPA desc, then `campaign_id` asc.
  - Top CPA: CPA asc, then CTR asc, then `campaign_id` asc.
- **Number format:** CTR with 4 decimals, CPA with 2 decimals, spend with 2 decimals.
- **Malformed rows:** skipped and logged to `errors.log`; the program does not stop. Checked: column count, empty `campaign_id`, date format and existence, non-negative integers for impressions/clicks/conversions, non-negative numbers for spend.
- **Header:** the first line must match the required schema exactly, otherwise the program exits with an error.
- **Line numbers:** physical file lines, so the header is line 1.
- **Quoted CSV fields** are not supported; the dataset has none.

## Benchmark

Processing time and peak memory usage for the full dataset, measured over 5 runs with `/usr/bin/time -l`, are recorded in `benchmark.log`.

## Project structure

```
src/cli.js         CLI entry point and argument parsing
src/processor.js   Header check, byte-range split and worker coordination
src/worker.js      Worker thread that reads one byte range
src/parser.js      Row validation and parsing
src/aggregator.js  Per-campaign totals and CTR/CPA
src/ranking.js     Top 10 CTR and CPA selection
src/output.js      CSV writing
tests/aggregator.test.js  Unit tests (small inputs)
tests/rankings.test.js    Reconciliation with inputs/ad_data.csv and results/
```
