# study-memory

Read and write `memory/progress.json` and `memory/daily-log.md`.

## Files

| File | Purpose |
|------|---------|
| `memory/progress.json` | Canonical structured state — chapter progress, ingest status, session counts |
| `memory/daily-log.md` | Append-only operational narrative — one line per meaningful change |

## progress.json field schema

```json
{
  "last_updated": "ISO-8601 timestamp",
  "exam_date": "2026-03-31",
  "sources": {
    "<source_batch_id>": {
      "total_chapters": 0,
      "chapters_ingested": 0,
      "chapters_started": 0,
      "chapters_completed": 0,
      "questions_answered": 0,
      "questions_correct": 0
    }
  },
  "active_chapter": "<chapter_id> or null",
  "next_actions": ["..."],
  "ingest_status": {
    "<chapter_id>": "uploaded | queued | processing | completed | failed"
  }
}
```

## Update rules

1. Always update `last_updated` to current ISO timestamp on any write.
2. Keep `sources.*` counters consistent with D1 state — do not infer from local memory alone; query D1 and reconcile if uncertain.
3. `next_actions` is a short ordered list of the single most important next step per source batch.
4. Never decrement `chapters_completed` — sessions can be re-opened but completions are additive.

## daily-log.md protocol

- Append only. Never edit or delete existing lines.
- Format: `YYYY-MM-DD HH:MM UTC | <action> | <detail>`
- Examples:
  - `2026-02-24 14:00 UTC | ingest_triggered | us-01 source_id=abc123`
  - `2026-02-24 14:05 UTC | session_started | us-01 user=tg:user:123`
  - `2026-02-24 14:30 UTC | progress_updated | us-01 answered=5 correct=4`
- One line per atomic action. Do not batch multiple events into one line.

## Consistency requirements

- After any D1 write (attempt recorded, session updated), sync the affected counter in progress.json within the same agent turn.
- If a counter mismatch is detected between memory and D1, trust D1 and update memory to match.
