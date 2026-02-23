# ACEP Course Question Generation Pathway

Last updated: February 23, 2026
Owner: Gabe
Status: Source upload complete; question generation pipeline ready to execute

## 1) Section definition

1. `ACEP Course` is one section.
2. Each study unit is a paired source set: `handout + lecture` for the same topic.
3. Total pairs: `23`.
4. Minimum target: `25` questions per pair.
5. Minimum section total: `575` questions.

## 2) Source-of-truth artifacts

1. Pair manifest: `/Applications/clawstudy/memory/acep-course-pairs-manifest-2026-02-23.csv`
2. Upload manifest: `/Applications/clawstudy/memory/acep-course-upload-manifest-2026-02-23.tsv`
3. Upload results: `/Applications/clawstudy/memory/acep-course-upload-results-2026-02-23.csv`
4. R2 prefix: `sources/acep-course-2026/pairs/`
5. Bucket: `clawstudydata`

Upload state on February 23, 2026:

1. `46/46` PDFs uploaded (`23` handouts + `23` lecture slide decks)
2. Pairing exception handled in manifest:
- Pair `06`: handout `06` + lecture `07`
- Pair `07`: handout `07` + lecture `06`

## 3) Exam-level question blueprint (attending physician, EM FPD US prep)

Per pair (`>=25` questions):

1. `10` interpretation-heavy items:
- image/findings recognition
- normal vs pathologic differentiation
2. `8` clinical integration items:
- pretest probability + bedside decision integration
- hemodynamic/ED workflow implications
3. `4` technical quality/pitfall items:
- probe selection, artifacts, optimization, false positives/negatives
4. `3` advanced decision items:
- next test/procedure, contraindications, escalation, competing diagnoses

Difficulty mix per pair:

1. `40%` core board-level recognition
2. `40%` applied attending-level decision making
3. `20%` edge-case/pitfall/advanced nuance

## 4) Generation pipeline per pair

1. Ingest both PDFs into a single pair context:
- `pair_id` is the unit of generation and review.
2. Build chunk index with source provenance:
- every chunk keeps `source_type` (`handout` or `lecture`), `page`, and `r2_key`.
3. Extract image refs and figure captions where available:
- attach `image_ref` and `image_description` candidates at chunk level.
4. Generate draft question batch (`30` target) to leave review buffer.
5. Run QA gate and publish at least `25` approved questions.
6. Persist per-question metadata:
- `pair_id`, `question_id`, `topic`, `difficulty`, `image_ref`, `image_description`, `source_citation`.

## 5) QA gate (must pass before publish)

1. Coverage:
- at least `25` approved questions for the pair.
2. Citation integrity:
- each question cites source page(s) from handout or lecture.
3. Distractor quality:
- no obviously wrong throwaway options.
4. Duplicate control:
- no semantic duplicates within the pair set.
5. Image fallback readiness:
- if `image_ref` exists, `image_description` must also exist.

## 6) Channel delivery behavior (Telegram + Twilio)

Canonical question payload fields:

1. `question_text`
2. `choices[]`
3. `correct_choice`
4. `explanation`
5. `source_citation`
6. `image_ref` (optional)
7. `image_description` (required when `image_ref` exists)

Delivery rules:

1. Telegram:
- try image send first when `image_ref` is resolvable
- fallback to text plus `Image description:` when image send fails
2. Twilio SMS/MMS:
- keep text-first behavior as baseline
- include `Image description:` whenever `image_ref` exists
- optional MMS can be enabled later by adding signed media URL generation for `MediaUrl`

This preserves dual-channel operation while Twilio number verification is pending.

## 7) Pair progress memory and execution controls

1. Pair-level tracker file:
- `/Applications/clawstudy/memory/acep-course-question-progress-2026-02-23.csv`
2. Section summary memory:
- `/Applications/clawstudy/memory/acep-course-section-memory-2026-02-23.json`
3. Required status transitions per pair:
- `uploaded_not_generated -> draft_generated -> reviewed -> approved_min25 -> published`

## 8) Operational test checklist

1. Pull one pair and verify object accessibility from R2.
2. Generate a draft batch and verify `image_ref` + `image_description` pairing.
3. Send one sample question through Telegram and Twilio paths.
4. Confirm answer scoring and progress update write succeeds.
5. Confirm published count per pair is `>=25` before marking complete.

## 9) Next execution sequence

1. Build/enable pair-ingest + question-generation worker path in `study-service`.
2. Process pairs in exam-priority order (cardiac, trauma/resuscitation, thoracic, aorta, DVT/VTE analog domains first).
3. Publish the first `5` pairs, run live channel validation, then scale to all `23` pairs.
