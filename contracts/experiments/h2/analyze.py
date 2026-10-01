"""
H2 experiment — analysis of results-<scenario>.csv written by test/H2Experiment.t.sol.

Deviation = |oracle price at settlement - quoted price| / quoted price, computed exactly from the
recorded integers (the contract's own rule floors it to whole basis points).

Run:  python3 analyze.py   -> prints a table and writes summary.csv
"""

import csv
from pathlib import Path

HERE = Path(__file__).parent
SCENARIOS = ["realistic", "conservative", "stress"]
TARGET_BPS = 10  # FYP-1 H2: below 0.10%
LIMIT_BPS = 50  # MoharToken.maxDeviationBps()


def pct(values, q):
    s = sorted(values)
    k = (len(s) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def main() -> None:
    rows_out = []
    for name in SCENARIOS:
        with (HERE / f"results-{name}.csv").open() as f:
            rows = list(csv.DictReader(f))
        devs = [
            abs(int(r["oracle_price"]) - int(r["quoted_price"])) / int(r["quoted_price"]) * 1e4
            for r in rows
        ]
        executed = [r for r in rows if r["outcome"] == "executed"]
        exec_devs = [d for r, d in zip(rows, devs) if r["outcome"] == "executed"]
        at_oracle = sum(r["executed_oracle_price"] == r["oracle_price"] for r in executed)
        rejected_moved = sum(
            r["balance_change"] != "0" for r in rows if r["outcome"] == "rejected"
        )
        rows_out.append(
            {
                "scenario": name,
                "trials": len(rows),
                "executed": len(executed),
                "rejected": len(rows) - len(executed),
                "executed_at_oracle_price": at_oracle,
                "rejected_that_moved_gold": rejected_moved,
                "median_dev_bps": round(pct(devs, 0.5), 2),
                "p95_dev_bps": round(pct(devs, 0.95), 2),
                "p99_dev_bps": round(pct(devs, 0.99), 2),
                "max_dev_bps": round(max(devs), 2),
                "max_executed_dev_bps": round(max(exec_devs), 2) if exec_devs else "",
                "share_over_target_pct": round(100 * sum(d > TARGET_BPS for d in devs) / len(devs), 1),
                "share_over_limit_pct": round(100 * sum(d > LIMIT_BPS for d in devs) / len(devs), 1),
            }
        )

    with (HERE / "summary.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows_out[0]))
        w.writeheader()
        w.writerows(rows_out)
    for r in rows_out:
        print(r)


if __name__ == "__main__":
    main()
