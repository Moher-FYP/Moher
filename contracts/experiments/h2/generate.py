"""
H2 experiment — input generator.

Produces seeded trial sets for three market scenarios. Each trial is one mint or burn quoted at
P0 (USD 4,616/oz, the FYP-1 spot) and settled after the gold price has moved. The Foundry
experiment (test/H2Experiment.t.sol) executes every trial against the real contracts.

Scenarios (move = oracle price at settlement vs the quoted price):
  realistic     normal, sigma from GVZ over a 90-second quote-to-settlement window,
                annual volatility spread over ~23 trading hours a day
  conservative  same GVZ, spread over the 6.5-hour US session only (larger per-minute moves)
  stress        uniform between -5% and +5% (far beyond any real 90-second move)

Run:  python3 generate.py      (deterministic; same files every time)
"""

import csv
import math
import random
from pathlib import Path

HERE = Path(__file__).parent
SEED = 20261002
TRIALS = 1_000  # per scenario: 500 mints + 500 burns
P0 = 4_616 * 10**8  # XAU/USD, 8 decimals

# CBOE Gold ETF Volatility Index (GVZCLS), 29 Sep 2026: 24.37 (annualised %, FRED).
GVZ = 0.2437
TRADING_DAYS = 252
WINDOW_SECONDS = 90  # 60 s quote hold + settlement margin


def window_sigma(minutes_per_day: float) -> float:
    per_minute = GVZ / math.sqrt(TRADING_DAYS) / math.sqrt(minutes_per_day)
    return per_minute * math.sqrt(WINDOW_SECONDS / 60)


SCENARIOS = {
    "realistic": ("normal", window_sigma(23 * 60)),
    "conservative": ("normal", window_sigma(6.5 * 60)),
    "stress": ("uniform", 0.05),
}


def grams(rng: random.Random) -> int:
    """Log-uniform between 0.01 g and 1,000 g, in 1e-8 g units."""
    g = 10 ** rng.uniform(math.log10(0.01), math.log10(1_000))
    return max(1, round(g * 10**8))


def main() -> None:
    for i, (name, (kind, param)) in enumerate(SCENARIOS.items()):
        rng = random.Random(SEED + i)
        path = HERE / f"input-{name}.csv"
        with path.open("w", newline="") as f:
            w = csv.writer(f)
            for trial in range(TRIALS):
                side = "mint" if trial % 2 == 0 else "burn"
                move = rng.gauss(0, param) if kind == "normal" else rng.uniform(-param, param)
                oracle = round(P0 * (1 + move))
                w.writerow([trial, side, grams(rng), P0, oracle])
        sigma = f"sigma={param * 100:.4f}%" if kind == "normal" else f"range=+/-{param * 100:.0f}%"
        print(f"{path.name}: {TRIALS} trials, {kind} {sigma}")


if __name__ == "__main__":
    main()
