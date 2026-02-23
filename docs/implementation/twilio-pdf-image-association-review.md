# Twilio PDF Image Association Review

Last updated: February 23, 2026
Owner: Gabe
Scope: `/Users/gabe/Downloads/Textbooks and FPD Prep/Emergency and Clinical Ultrasound` (18 PDFs)

## 1) Review artifacts

Generated with:

```bash
bash /Applications/clawstudy/scripts/review-pdf-image-question-map.sh
```

Output files:

1. `/Applications/clawstudy/memory/pdf-image-inventory-2026-02-23.csv`
2. `/Applications/clawstudy/memory/pdf-question-image-page-map-2026-02-23.csv`
3. `/Applications/clawstudy/memory/pdf-question-image-summary-2026-02-23.csv`

## 2) Findings

1. All 18 chapter PDFs contain embedded image rows.
2. Across the corpus:
- detected question rows: `365`
- question rows on pages with embedded images: `298`
- observed same-page image association rate: `81.6%`
3. Lower image-association chapters (same-page heuristic):
- `us-15` DVT and VTE: `65.0%`
- `us-17` Bowel and Appendix: `60.0%`
- `us-18` MSK: `64.7%`
4. Example chapter `us-07` Hepatobiliary:
- pages: `73`
- image rows: `76`
- detected questions: `31`
- question rows on pages with images: `28`

## 3) Current behavior in study-service

1. Telegram path attempts `sendPhoto` when `image_ref` exists.
2. SMS (Twilio) path is text-first and now includes `Image description:` when `image_ref` exists.
3. Pilot seeding currently supports one chapter-level `image_object_key`; it does not yet map unique images per question.

## 4) Recommended Twilio attachment strategy

1. Keep current text-safe behavior as fallback:
- always include `Image description:` when `image_ref` exists.
2. Add MMS media when available:
- respond with TwiML `<Media>` URL (or REST `MediaUrl`) for the selected image.
3. Question-to-image selection order:
- explicit figure/video reference in question/explanation text (e.g., `Figure X.Y`)
- otherwise first image on same page as question stem
- otherwise nearest page within `±1`
- otherwise description-only fallback
4. Store and serve media as stable public/signed URLs from Worker endpoints backed by R2.
5. Track delivery outcomes (`sent`, `fallback_description`, `media_fetch_failed`) for tuning.

## 5) Build implication

To achieve robust Twilio MMS, ingestion must persist per-question media metadata, not only a chapter-level image key.
