#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="${1:-/Users/gabe/Downloads/Textbooks and FPD Prep/Emergency and Clinical Ultrasound}"
OUT_DIR="${2:-/Applications/clawstudy/memory}"
STAMP="$(date +%Y-%m-%d)"

need_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
}

need_cmd pdfimages
need_cmd pdfinfo
need_cmd pdftotext
need_cmd rg

if [ ! -d "$SRC_DIR" ]; then
  echo "Source directory not found: $SRC_DIR"
  exit 1
fi

mkdir -p "$OUT_DIR"

INVENTORY_OUT="$OUT_DIR/pdf-image-inventory-${STAMP}.csv"
DETAIL_OUT="$OUT_DIR/pdf-question-image-page-map-${STAMP}.csv"
SUMMARY_OUT="$OUT_DIR/pdf-question-image-summary-${STAMP}.csv"

printf "chapter_id,file_name,pages,image_rows\n" > "$INVENTORY_OUT"
printf "chapter_id,file_name,question_number,page,image_rows_on_page,figure_or_video_markers_on_page,question_line\n" > "$DETAIL_OUT"
printf "chapter_id,file_name,pages,image_rows_total,detected_questions,questions_on_pages_with_images,questions_on_pages_without_images\n" > "$SUMMARY_OUT"

while IFS= read -r pdf; do
  bn="$(basename "$pdf")"
  num_raw="$(printf '%s' "$bn" | sed -E 's/^([0-9]+)\..*/\1/')"
  num="$(printf '%02d' "$num_raw")"
  chapter_id="us-${num}"
  pages="$(pdfinfo "$pdf" | awk -F: '/^Pages:/ {gsub(/^[ \t]+/,"",$2); print $2; exit}')"

  tmpdir="$(mktemp -d)"
  pdfimages -list "$pdf" | awk 'NR>2 && NF>0 {c[$1]++} END {for (p in c) print p","c[p]}' | sort -t, -k1,1n > "$tmpdir/img_per_page.csv"
  image_rows_total="$(awk -F, '{s+=$2} END {print s+0}' "$tmpdir/img_per_page.csv")"

  printf "%s,%s,%s,%s\n" "$chapter_id" "$bn" "$pages" "$image_rows_total" >> "$INVENTORY_OUT"

  for p in $(seq 1 "$pages"); do
    txt="$(pdftotext -layout -f "$p" -l "$p" "$pdf" - | tr -d '\r')"
    img_rows="$(awk -F, -v p="$p" '$1==p {print $2}' "$tmpdir/img_per_page.csv")"
    if [ -z "$img_rows" ]; then img_rows=0; fi

    markers="$(printf '%s\n' "$txt" | rg -o "(Figure|Video) [0-9]+\.[0-9]+" -S || true)"
    marker_count="$(printf '%s\n' "$markers" | sed '/^$/d' | wc -l | tr -d ' ')"

    question_lines="$(printf '%s\n' "$txt" | sed 's/^\s*//' | rg -n "^[0-9]{1,3}\.\s+" -S || true)"
    if [ -n "$question_lines" ]; then
      printf '%s\n' "$question_lines" | while IFS= read -r qline; do
        qtext="$(printf '%s' "$qline" | sed -E 's/^[0-9]+://')"
        qnum="$(printf '%s' "$qtext" | sed -E 's/^([0-9]{1,3})\..*/\1/')"
        clean_qtext="$(printf '%s' "$qtext" | tr '\n' ' ' | sed -E 's/"/""/g; s/[[:space:]]+/ /g; s/^ //; s/ $//')"
        printf "%s,%s,%s,%s,%s,%s,\"%s\"\n" "$chapter_id" "$bn" "$qnum" "$p" "$img_rows" "$marker_count" "$clean_qtext" >> "$DETAIL_OUT"
      done
    fi
  done

  detected_questions="$(awk -F, -v c="$chapter_id" 'NR>1 && $1==c {print $3}' "$DETAIL_OUT" | sort -n | uniq | wc -l | tr -d ' ')"
  with_images="$(awk -F, -v c="$chapter_id" 'NR>1 && $1==c && $5>0 {print $3}' "$DETAIL_OUT" | sort -n | uniq | wc -l | tr -d ' ')"
  without_images=$((detected_questions - with_images))

  printf "%s,%s,%s,%s,%s,%s,%s\n" "$chapter_id" "$bn" "$pages" "$image_rows_total" "$detected_questions" "$with_images" "$without_images" >> "$SUMMARY_OUT"

  rm -rf "$tmpdir"
done < <(find "$SRC_DIR" -maxdepth 1 -type f -name '*.pdf' | sort -V)

echo "Wrote:"
echo "  $INVENTORY_OUT"
echo "  $DETAIL_OUT"
echo "  $SUMMARY_OUT"

