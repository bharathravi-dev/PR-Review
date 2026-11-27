# Benchmarks

How well does pr-reviewer find real problems, and how much noise does it add? We measure on the public
**golden comments** set: 50 PRs from 5 open-source repositories (cal.com, Sentry, Grafana, Keycloak, Discourse),
each with the issues a good review should find (Greptile's benchmark as corrected by Augment). Vendors benchmark
themselves and win ([DeepSource](https://deepsource.com/blog/ai-code-review-benchmarks)), so everything here is
reproducible with the commands below, and incomplete runs are reported as incomplete.

## Method

- **Precision:** of the inline comments pr-reviewer would post, how many match a golden issue.
- **Recall:** of the golden issues, how many a comment matches. **F1** combines both.
- **Matching:** same file, within 5 lines, and the same problem, judged by an AI judge (`matching.judge` in the
  results; when the judge shares the reviewer's model family the results say so).
- Only comments pr-reviewer would post count: inline, about the change, at or above the inline severity floor.

## Reproduce

```bash
node scripts/bench-import-golden.mjs --out bench/data/golden-50.json      # downloads the gold set (not vendored)
node packages/cli/bin/pr-reviewer.js bench bench/data/golden-50.json --out bench/results/<name>.json
node scripts/bench-report.mjs bench/results/*.json                      # the table below
```

A full run reviews 50 PRs (about 75k tokens each with Claude); `--projects cal_dot_com` runs 10.

## Results

| Run | Reviewer | Dataset | Precision | FP Rate | Recall | F1 | Comments/PR | Guard Drops | Time p50 | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline (2026-11-25) | claude-code | golden (cal.com), 10 PRs × 1 | 26% | 74% | 78% | 39% | 6.9 | — | 78 s | Complete run; predates noise & verification updates |
| verify-cal_dot_com (2026-11-25) | claude-code (verify) | golden (cal.com), 10 PRs × 1 | 43% | 57% | 100% | 60% | 3.5 | — | 101 s | Incomplete (`failedCases: 8` due to quota/errors; not comparable as a full run) |

A full 50-PR run (`--effort standard`, with quote/hunk grounding, `standard` verification, `<language_standards>`, `tests.local`, and `sonar.api`) requires live GitHub + LLM access (`pr-reviewer bench bench/data/golden-50.json --judge openai --out bench/results/v0.1.2.json`). Offline hallucination-trap regression scoring is verified continuously in `packages/cli/src/bench-hallucination.test.ts`.
