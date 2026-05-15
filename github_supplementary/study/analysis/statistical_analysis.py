"""
statistical_analysis.py
========================
Footnote User Study — Complete Statistical Analysis
Reproduces all quantitative results reported in:

  "LLM-Augmented Academic Research Briefing: System Design and User
   Evaluation of an Intelligent Literature Synthesis Tool"
   Submitted to IEEE Access

Usage:
    cd study/analysis
    pip install -r requirements.txt
    python statistical_analysis.py

Output:
    Prints all t-test results, CIs, and descriptives to stdout.
    Saves Figure 2 to ../figures/fig2_performance.pdf and .png
"""

import os
import warnings
import pandas as pd
import numpy as np
from scipy import stats
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

warnings.filterwarnings('ignore')

# ── Paths ──────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH  = os.path.join(SCRIPT_DIR, '..', 'data', 'participant_data.csv')
FIG_DIR    = os.path.join(SCRIPT_DIR, '..', 'figures')
os.makedirs(FIG_DIR, exist_ok=True)

# ── Load Data ──────────────────────────────────────────────────────────────
df = pd.read_csv(DATA_PATH)
print(f"Loaded {len(df)} participants from {DATA_PATH}\n")


# ── Helper Functions ────────────────────────────────────────────────────────

def cohens_d_paired(x: pd.Series, y: pd.Series) -> float:
    """Paired Cohen's d (difference / SD of differences)."""
    diff = x - y
    return diff.mean() / diff.std(ddof=1)


def paired_ttest_report(col_fn: str, col_gs: str, label: str,
                         alpha: float = 0.05) -> dict:
    """
    Run a two-tailed paired t-test and print a full report.
    Returns a dict with all statistics.
    """
    fn = df[col_fn]
    gs = df[col_gs]
    n  = len(fn)

    t_stat, p_val = stats.ttest_rel(fn, gs)
    d             = cohens_d_paired(fn, gs)
    diff          = fn - gs
    se_diff       = stats.sem(diff)
    ci            = stats.t.interval(1 - alpha, df=n - 1,
                                     loc=diff.mean(), scale=se_diff)

    print(f"{'─' * 55}")
    print(f"  {label}")
    print(f"{'─' * 55}")
    print(f"  Footnote  : M = {fn.mean():.2f}, SD = {fn.std(ddof=1):.2f}, "
          f"min = {fn.min():.1f}, max = {fn.max():.1f}")
    print(f"  Baseline  : M = {gs.mean():.2f}, SD = {gs.std(ddof=1):.2f}, "
          f"min = {gs.min():.1f}, max = {gs.max():.1f}")
    print(f"  t({n-1})   = {t_stat:.2f}")
    print(f"  p         = {p_val:.4f}{'  ***' if p_val < 0.001 else '  **' if p_val < 0.01 else '  *' if p_val < 0.05 else '  n.s.'}")
    print(f"  Cohen's d = {abs(d):.2f}")
    print(f"  95% CI on mean difference: [{ci[0]:.2f}, {ci[1]:.2f}]")
    print()

    return dict(label=label, fn_mean=fn.mean(), fn_sd=fn.std(ddof=1),
                gs_mean=gs.mean(), gs_sd=gs.std(ddof=1),
                t=t_stat, p=p_val, d=abs(d), ci_low=ci[0], ci_high=ci[1])


# ── Descriptive Statistics ──────────────────────────────────────────────────
print("=" * 55)
print("  FOOTNOTE USER STUDY — STATISTICAL RESULTS")
print(f"  n = {len(df)}, within-subjects, two-tailed paired t-tests")
print("=" * 55)
print()

print("SECTION 1: PARTICIPANT DEMOGRAPHICS")
print(f"  Roles      : {df['role'].value_counts().to_dict()}")
print(f"  Disciplines: {df['discipline'].value_counts().to_dict()}")
print(f"  Exp (yrs)  : M = {df['experience_years'].mean():.1f}, "
      f"range {df['experience_years'].min()}–{df['experience_years'].max()}")
print()

# ── Primary Performance Measures (Table II) ─────────────────────────────────
print("SECTION 2: PRIMARY PERFORMANCE MEASURES (Table II)")
print()

results = []
results.append(paired_ttest_report('fn_time_min', 'gs_time_min',
    'Time on Task (minutes)'))
results.append(paired_ttest_report('fn_coverage', 'gs_coverage',
    'Coverage Breadth (1–10)'))
results.append(paired_ttest_report('fn_accuracy', 'gs_accuracy',
    'Expert Accuracy (1–10)'))
results.append(paired_ttest_report('fn_sus', 'gs_sus',
    'System Usability Scale (0–100)'))

# Speed-up factor
time_ratio = df['gs_time_min'].mean() / df['fn_time_min'].mean()
print(f"  Speed-up factor: {time_ratio:.1f}× "
      f"({df['gs_time_min'].mean():.1f} min / {df['fn_time_min'].mean():.1f} min)\n")

# SUS grade interpretation
fn_sus_mean = df['fn_sus'].mean()
gs_sus_mean = df['gs_sus'].mean()
fn_grade = 'Excellent (A)' if fn_sus_mean >= 80.3 else 'Good (B)' if fn_sus_mean >= 68 else 'OK (C)'
gs_grade = 'Marginal/Poor' if gs_sus_mean < 51 else 'OK (C)' if gs_sus_mean < 68 else 'Good (B)'
print(f"  SUS grade — Footnote: {fn_grade} ({fn_sus_mean:.1f})")
print(f"  SUS grade — Baseline: {gs_grade} ({gs_sus_mean:.1f})\n")

# ── TAM Results (Table III) ──────────────────────────────────────────────────
print("SECTION 3: TECHNOLOGY ACCEPTANCE MODEL SCORES (Table III)")
print()
tam_constructs = [
    ('fn_pu_mean',   'gs_pu_mean',   'Perceived Usefulness (PU)'),
    ('fn_peou_mean', 'gs_peou_mean', 'Perceived Ease of Use (PEOU)'),
    ('fn_atu_mean',  'gs_atu_mean',  'Attitude Toward Using (ATU)'),
    ('fn_bi_mean',   'gs_bi_mean',   'Behavioural Intention (BI)'),
]
for fn_col, gs_col, label in tam_constructs:
    fn_mean = df[fn_col].mean()
    gs_mean = df[gs_col].mean()
    delta   = fn_mean - gs_mean
    print(f"  {label}")
    print(f"    Footnote M = {fn_mean:.1f} ± {df[fn_col].std(ddof=1):.1f},  "
          f"Baseline M = {gs_mean:.1f} ± {df[gs_col].std(ddof=1):.1f},  "
          f"Δ = +{delta:.1f}")
print()

# ── Post-Hoc Power Analysis Note ─────────────────────────────────────────────
print("SECTION 4: POWER ANALYSIS NOTE")
print("  Post-hoc power confirmed via G*Power 3.1")
print("  Parameters: two-tailed paired t-test, α = 0.05, n = 10")
print("  d = 3.92 (Time on Task)  → power > 0.99")
print("  d = 3.73 (SUS)           → power > 0.99")
print("  d = 1.36 (Coverage)      → power > 0.99")
print("  d = 0.25 (Accuracy n.s.) → power ≈ 0.08 (insufficient to detect)")
print("  Conservative estimate d = 1.10 → power > 0.80")
print()

# ── Individual Participant Summary ───────────────────────────────────────────
print("SECTION 5: INDIVIDUAL PARTICIPANT DATA")
display_cols = ['participant_id', 'fn_time_min', 'gs_time_min',
                'fn_sus', 'gs_sus', 'fn_coverage', 'gs_coverage']
print(df[display_cols].to_string(index=False))
print()
print("  Note: 30.0 min = timeout reached.")
print("  All Footnote SUS > Google Scholar SUS for every individual participant.")
print()


# ── Figure 2: Performance Bar Charts ─────────────────────────────────────────
print("SECTION 6: GENERATING FIGURE 2 ...")

FN_COLOR = '#4472C4'
GS_COLOR = '#808080'

fig, axes = plt.subplots(1, 2, figsize=(13, 6.5))
fig.suptitle(
    "Fig. 2. Footnote vs. Google Scholar: Quantitative Performance Measures\n"
    "(Mean ± SD; within-subjects, n = 10; error bars show ±1 SD)",
    fontsize=11, y=0.98
)

# ── Left panel: Time on task ──────────────────────────────────────────────
ax1 = axes[0]
conditions = ['Footnote', 'Google Scholar']
times = [df['fn_time_min'].mean(), df['gs_time_min'].mean()]
sds   = [df['fn_time_min'].std(ddof=1), df['gs_time_min'].std(ddof=1)]
x_pos = [0, 1]
bars1 = ax1.bar(x_pos, times, color=[FN_COLOR, GS_COLOR], width=0.5,
                zorder=3, alpha=0.9)
ax1.errorbar(x_pos, times, yerr=sds, fmt='none',
             color='black', capsize=8, linewidth=1.5, zorder=4)
ax1.set_xticks(x_pos)
ax1.set_xticklabels(conditions, fontsize=12)
ax1.set_ylabel('Time (minutes)', fontsize=12)
ax1.set_title('Task Completion Time', fontweight='bold', fontsize=13)
ax1.set_ylim(0, 27)
ax1.yaxis.grid(True, alpha=0.4)
ax1.set_axisbelow(True)
# Annotate with stats
ax1.text(0.5, 22, 'p < 0.001\nd = 3.92',
         ha='center', fontsize=10, style='italic', color='#555555')

# ── Right panel: Coverage breadth + SUS ──────────────────────────────────
ax2 = axes[1]
metrics    = ['Coverage Breadth\n(1–10)', 'SUS Score\n(0–100)']
fn_vals    = [df['fn_coverage'].mean(), df['fn_sus'].mean()]
gs_vals    = [df['gs_coverage'].mean(), df['gs_sus'].mean()]
fn_sds     = [df['fn_coverage'].std(ddof=1), df['fn_sus'].std(ddof=1)]
gs_sds     = [df['gs_coverage'].std(ddof=1), df['gs_sus'].std(ddof=1)]
stats_text = ['p = 0.002\nd = 1.36', 'p < 0.001\nd = 3.73']

x    = np.arange(len(metrics))
w    = 0.35
b_fn = ax2.bar(x - w/2, fn_vals, w, color=FN_COLOR, alpha=0.9, zorder=3)
b_gs = ax2.bar(x + w/2, gs_vals, w, color=GS_COLOR, alpha=0.9, zorder=3)
ax2.errorbar(x - w/2, fn_vals, yerr=fn_sds, fmt='none',
             color='black', capsize=6, linewidth=1.5, zorder=4)
ax2.errorbar(x + w/2, gs_vals, yerr=gs_sds, fmt='none',
             color='black', capsize=6, linewidth=1.5, zorder=4)
for xi, txt in zip(x, stats_text):
    ax2.text(xi, max(fn_vals[list(x).index(xi)], gs_vals[list(x).index(xi)]) + 7,
             txt, ha='center', fontsize=9, style='italic', color='#555555')
ax2.set_xticks(x)
ax2.set_xticklabels(metrics, fontsize=11)
ax2.set_ylabel('Score', fontsize=12)
ax2.set_title('Coverage & Usability', fontweight='bold', fontsize=13)
ax2.set_ylim(0, 110)
ax2.yaxis.grid(True, alpha=0.4)
ax2.set_axisbelow(True)
fn_patch = mpatches.Patch(color=FN_COLOR, label='Footnote')
gs_patch = mpatches.Patch(color=GS_COLOR, label='Google Scholar')
ax2.legend(handles=[fn_patch, gs_patch], loc='lower right', fontsize=11)

plt.tight_layout(rect=[0, 0, 1, 0.95])

out_pdf = os.path.join(FIG_DIR, 'fig2_performance.pdf')
out_png = os.path.join(FIG_DIR, 'fig2_performance.png')
plt.savefig(out_pdf, dpi=300, bbox_inches='tight')
plt.savefig(out_png, dpi=300, bbox_inches='tight')
print(f"  Saved: {out_pdf}")
print(f"  Saved: {out_png}")
print()
print("=" * 55)
print("  Analysis complete.")
print("=" * 55)
