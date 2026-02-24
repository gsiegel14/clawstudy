# Gottlieb POCUS Question Generation Pathway

Last updated: February 23, 2026
Owner: Gabe
Status: Source upload complete; chapter-wise generation plan ready to execute

## 1) Section definition

1. `Gottlieb POCUS by Chapter` is one section.
2. Each study unit is one chapter PDF.
3. Total chapters: `31` (`gp-00` through `gp-30`).
4. Minimum target: `25` questions per chapter.
5. Minimum section total: `775` questions.

## 2) Source-of-truth artifacts

1. Upload results: `/Applications/clawstudy/memory/uploaded-sources-gottlieb-pocus-by-chapter-2026-02-23.csv`
2. Chapter manifest: `/Applications/clawstudy/memory/gottlieb-chapters-manifest-2026-02-23.csv`
3. Question progress tracker: `/Applications/clawstudy/memory/gottlieb-question-progress-2026-02-23.csv`
4. Section memory: `/Applications/clawstudy/memory/gottlieb-section-memory-2026-02-23.json`
5. R2 prefix: `sources/gottlieb-pocus-by-chapter/`
6. Bucket: `clawstudydata`

Upload state on February 23, 2026:

1. `31/31` PDFs uploaded and retrieval-verified.

## 3) Chapter-level question blueprint (like ACEP, per chapter)

Per chapter (`>=25` questions):

1. `10` interpretation-heavy items:
- image/findings recognition
- normal vs pathologic differentiation
2. `8` clinical integration items:
- bedside decision making and management implications
3. `4` technical quality/pitfall items:
- probe choice, artifacts, optimization, common false positives/negatives
4. `3` advanced decision items:
- escalation, alternatives, contraindications, edge cases

Difficulty mix per chapter:

1. `40%` core board-level recognition
2. `40%` applied decision-making
3. `20%` advanced nuance/pitfalls

## 4) Generation pipeline per chapter

1. Ingest chapter PDF into chunk index with provenance (`source_id`, `page`, `r2_key`).
2. Extract image refs and candidate image descriptions where available.
3. Generate draft batch (`30` target) for review buffer.
4. Run QA gate and publish at least `25` approved questions.
5. Persist per-question metadata:
- `chapter_id`
- `question_id`
- `topic`
- `difficulty`
- `image_ref`
- `image_description`
- `source_citation`
- `source_order` (`page`, `question_index`)

## 5) Prompting pack (generator + QA + publish)

### System prompt template

```text
You are an emergency ultrasound board-prep item writer.
Generate attending-level, board-style MCQs from the provided chapter evidence only.
Do not invent facts outside the chapter evidence.
Every question must include one best answer, plausible distractors, and a concise explanation tied to source citations.
If a figure is used, include both image_ref and image_description.
Return strict JSON only.
```

### Chapter generation prompt template

```text
Task:
Generate {{target_questions}} draft MCQs for chapter {{chapter_id}} ({{chapter_name}}).

Constraints:
- Minimum publishable set later is {{min_questions}}.
- Maintain the chapter blueprint:
  - 10 interpretation-heavy
  - 8 clinical integration
  - 4 technical/pitfall
  - 3 advanced decision
- Difficulty mix:
  - 40% core
  - 40% applied
  - 20% advanced
- Preserve source-authored wording when the chapter already contains question-like stems.
- Include source_citation with page references for every item.
- Include image_description whenever image_ref is present.

Output schema (JSON):
{
  "chapter_id": "{{chapter_id}}",
  "draft_questions": [
    {
      "question_id": "{{chapter_id}}-q001",
      "topic": "string",
      "difficulty": "easy|medium|hard",
      "stem": "string",
      "choices": ["A", "B", "C", "D"],
      "correct_choice": "A|B|C|D",
      "explanation": "string",
      "source_citation": [{"page": 1, "excerpt": "string"}],
      "source_order": {"page": 1, "question_index": 1},
      "image_ref": "string|null",
      "image_description": "string|null",
      "quality_score": 0.0
    }
  ]
}

Evidence payload:
{{chapter_chunks_with_page_and_optional_image_metadata}}
```

### QA prompt template

```text
Validate this chapter draft set for {{chapter_id}}.
Reject or flag any item that violates:
1) missing citation,
2) weak/throwaway distractors,
3) duplicate stem intent,
4) unsupported claim outside cited evidence,
5) image_ref present but image_description missing.

Return strict JSON:
{
  "chapter_id": "{{chapter_id}}",
  "approved_questions": [...],
  "rejected_questions": [{"question_id":"...", "reason":"..."}],
  "summary": {"approved_count":0, "rejected_count":0}
}
```

### Publish prompt template

```text
Take approved questions for {{chapter_id}} and normalize them for runtime delivery.
Requirements:
1) stable source_order sorting,
2) deterministic question_id sequence,
3) preserve source-authored question/figure wording verbatim where applicable.
Return JSON array only.
```

## 6) Idempotent run keys

Use deterministic keys for all chapter generation writes:

1. Draft generation: `gottlieb:{chapter_id}:draft:v1`
2. QA pass: `gottlieb:{chapter_id}:qa:v1`
3. Publish: `gottlieb:{chapter_id}:publish:v1`

All write calls must include `Idempotency-Key`.

## 7) Channel delivery behavior (Telegram + SMS)

1. Telegram:
- send image when `image_ref` resolves
- fallback to text plus `Image description:` on media failure
2. SMS:
- text-first delivery
- include `Image description:` whenever `image_ref` exists
3. For source-authored chapter questions:
- keep strict source order and verbatim question/figure wording before explanation.

## 8) Execution sequence

1. Ingest `gp-00` to `gp-30` sources into chunk records.
2. Start with high-yield chapters first (`gp-03`, `gp-04`, `gp-05`, `gp-07`, `gp-08`, `gp-20`, `gp-21`, `gp-23`).
3. Generate `30` drafts/chapter.
4. Approve and publish `>=25`/chapter.
5. Update tracker files after each chapter run:
- `/Applications/clawstudy/memory/gottlieb-question-progress-2026-02-23.csv`
- `/Applications/clawstudy/memory/gottlieb-section-memory-2026-02-23.json`
