# Footnote — Open Science Supplementary Materials

**LLM-Augmented Academic Research Briefing: System Design and User Evaluation of an Intelligent Literature Synthesis Tool**

*Submitted to IEEE Access*

---

## Overview

This repository contains the complete supplementary materials for the Footnote user study, released as open science to support reproducibility and future research. This includes anonymised raw data, all study instruments, statistical analysis scripts, and the LLM system prompts used in the production system.

**Live system:** https://footnote-ai-app.vercel.app  
**Backend API:** https://footnote-ai-production.up.railway.app  
**Frontend source:** See `/frontend/` in this repo  
**Backend source:** See `/backend/` in this repo  

---

## Repository Structure

```
footnote-ai/
├── study/
│   ├── data/
│   │   ├── participant_data.csv          # All quantitative measures, anonymised
│   │   ├── tam_scores_detailed.csv       # Item-level TAM responses
│   │   └── sus_scores_individual.csv     # Per-item SUS responses
│   ├── analysis/
│   │   ├── statistical_analysis.py       # Reproduces all paper results
│   │   ├── thematic_analysis_codebook.md # Qualitative codebook
│   │   └── requirements.txt              # Python dependencies
│   ├── instruments/
│   │   ├── pre_study_questionnaire.md    # Full pre-study form (Q1–Q12)
│   │   ├── sus_questionnaire.md          # SUS instrument + scoring
│   │   ├── tam_questionnaire.md          # TAM instrument (14 items)
│   │   └── interview_guide.md            # Semi-structured interview guide
│   └── figures/
│       └── fig2_performance.pdf          # Reproduced by analysis script
├── prompts/
│   ├── system_prompt.txt                 # Primary synthesis system prompt
│   └── supplementary_prompts.txt         # On-demand panel prompts
└── docs/
    └── supplementary_appendices.pdf      # Full appendices (A–H)
```

---

## Study Summary

| Parameter | Value |
|-----------|-------|
| Design | Within-subjects, counterbalanced |
| Participants | n = 10 academic researchers |
| Conditions | Footnote vs. Google Scholar (control) |
| Tasks | T1: Transformer attention; T2: Gut microbiome & mental health |
| Session duration | Mean 74.3 min (range 62–88 min) |
| Session modality | Remote video conference with screen recording |
| Compensation | USD $30 Amazon gift card |
| Ethics | IRB-approved protocol [IRB-XXXX] |

### Key Results

| Measure | Footnote | Google Scholar | p | Cohen's d |
|---------|----------|---------------|---|-----------|
| Time on Task (min) | 4.2 ± 1.3 | 18.7 ± 4.2 | < 0.001 | 3.92 |
| SUS Score (0–100) | 84.3 ± 6.2 | 52.1 ± 8.7 | < 0.001 | 3.73 |
| Coverage Breadth (1–10) | 7.8 ± 0.9 | 5.9 ± 1.4 | 0.002 | 1.36 |
| Expert Accuracy (1–10) | 7.4 ± 0.8 | 7.1 ± 1.1 | 0.44 | 0.25 (n.s.) |

---

## Reproducing the Analysis

```bash
# 1. Clone the repo
git clone https://github.com/PrashaV/footnote-ai.git
cd footnote-ai/study/analysis

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run the analysis (reproduces all tables and Figure 2)
python statistical_analysis.py

# Output: prints all t-test results, effect sizes, CIs
# Saves: ../figures/fig2_performance.pdf
```

---

## Data Dictionary

### `participant_data.csv`

| Column | Type | Description |
|--------|------|-------------|
| participant_id | string | Anonymised ID (P01–P10) |
| role | string | Career stage |
| discipline | string | Research field |
| experience_years | integer | Years of research experience |
| searches_per_week | string | Self-reported search frequency |
| fn_time_min | float | Time on task — Footnote (minutes) |
| gs_time_min | float | Time on task — Google Scholar (minutes) |
| fn_sus | float | SUS score — Footnote (0–100) |
| gs_sus | float | SUS score — Google Scholar (0–100) |
| fn_coverage | integer | Expert coverage breadth — Footnote (1–10) |
| gs_coverage | integer | Expert coverage breadth — Google Scholar (1–10) |
| fn_accuracy | integer | Expert accuracy — Footnote (1–10) |
| gs_accuracy | integer | Expert accuracy — Google Scholar (1–10) |
| fn_pu_mean | float | TAM Perceived Usefulness mean — Footnote |
| gs_pu_mean | float | TAM Perceived Usefulness mean — Google Scholar |
| fn_peou_mean | float | TAM Perceived Ease of Use mean — Footnote |
| gs_peou_mean | float | TAM Perceived Ease of Use mean — Google Scholar |
| fn_atu_mean | float | TAM Attitude Toward Using mean — Footnote |
| gs_atu_mean | float | TAM Attitude Toward Using mean — Google Scholar |
| fn_bi_mean | float | TAM Behavioural Intention mean — Footnote |
| gs_bi_mean | float | TAM Behavioural Intention mean — Google Scholar |

---

## Ethics & Data Privacy

All participants provided written informed consent. No personally identifying information is included in this dataset. Participant IDs (P01–P10) were assigned randomly and do not correspond to any identifying sequence. Audio recordings and video screen captures from study sessions are not released in accordance with participant consent agreements. IRB protocol: [IRB-XXXX — to be inserted upon deanonymisation].

---

## Citation

If you use these materials in your research, please cite:

```
[Author(s)]. "LLM-Augmented Academic Research Briefing: System Design and 
User Evaluation of an Intelligent Literature Synthesis Tool." IEEE Access, 2024.
```

---

## License

Study instruments, data, and analysis scripts are released under CC BY 4.0.  
Source code (frontend + backend) is released under MIT License.
