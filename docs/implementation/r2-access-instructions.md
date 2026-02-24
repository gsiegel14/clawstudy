# R2 Access Instructions (ClawStudy + Moltbot)

Last updated: February 24, 2026
Owner: Gabe

## 1) Which bucket to use

1. Study PDFs and question assets:
- bucket: `clawstudydata`
- Worker binding: `STUDY_ASSETS`
- config: `/Applications/clawstudy/study-service/wrangler.jsonc`
2. Moltbot gateway persistence (workspace/config backups):
- current deployed bucket: `clawstudydata`
- Worker binding: `MOLTBOT_BUCKET`
- active worker: `clawstudyme`
- note: some upstream/default examples use `moltbot-data`; follow deployed binding value.

## 2) Common prefixes

1. Emergency Ultrasound chapters:
- `sources/emergency-clinical-ultrasound/`
2. ACEP paired handout+lecture corpus:
- `sources/acep-course-2026/pairs/`
3. Gottlieb chapters:
- `sources/gottlieb-pocus-by-chapter/`
4. Gateway backup paths (`clawstudydata` under gateway prefixes):
- `openclaw/`
- `workspace/`
- `skills/`

## 3) CLI setup

Run from `study-service` to use the project-pinned Wrangler:

```bash
cd /Applications/clawstudy/study-service
source ~/.nvm/nvm.sh && nvm use 22
export WRANGLER=./node_modules/.bin/wrangler
$WRANGLER whoami
```

## 4) List buckets and objects

```bash
# list all R2 buckets in account
$WRANGLER r2 bucket list

# list ACEP objects
$WRANGLER r2 object list clawstudydata --prefix sources/acep-course-2026/pairs/

# list gateway backup files
$WRANGLER r2 object list clawstudydata --prefix openclaw/
```

## 5) Download and upload objects

```bash
# download one object
$WRANGLER r2 object get \
  clawstudydata/sources/acep-course-2026/pairs/01/handout/1.-aemus-26_physics-handout.pdf \
  --file /tmp/acep-pair-01-handout.pdf

# upload one object
$WRANGLER r2 object put \
  clawstudydata/sources/manual-test/test.pdf \
  --file /path/to/local/test.pdf
```

## 6) Verify objects against manifests

Use memory manifests as source of truth:

1. `/Applications/clawstudy/memory/acep-course-upload-results-2026-02-23.csv`
2. `/Applications/clawstudy/memory/acep-course-pairs-manifest-2026-02-23.csv`
3. `/Applications/clawstudy/memory/uploaded-sources-emergency-ultrasound-2026-02-23.csv`
4. `/Applications/clawstudy/memory/uploaded-sources-gottlieb-pocus-by-chapter-2026-02-23.csv`

Quick upload-status check (ACEP):

```bash
awk -F, 'NR>1 {total++; if($5=="uploaded") ok++; else fail++} END {printf "total=%d uploaded=%d failed=%d\n", total, ok, fail}' \
  /Applications/clawstudy/memory/acep-course-upload-results-2026-02-23.csv
```

## 7) Access from Worker runtime

Study-service reads/writes from `STUDY_ASSETS`:

```ts
const obj = await env.STUDY_ASSETS.get(objectKey);
if (!obj) return new Response('Not found', { status: 404 });
return new Response(obj.body, {
  headers: {
    'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
  },
});
```

```ts
await env.STUDY_ASSETS.put(objectKey, bytes, {
  httpMetadata: { contentType: 'application/pdf' },
});
```

Moltworker persistence uses `MOLTBOT_BUCKET` through its startup/sync flow. In current deployment this points to `clawstudydata`, so keep gateway and study artifacts separated by prefix.

## 8) Access model and security

1. R2 objects are private by default.
2. Do not assume direct public URL access.
3. Serve files through authenticated Worker endpoints (or short-lived signed URLs when implemented).
4. Keep `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` in Wrangler secrets only.

## 9) Troubleshooting

1. `Authentication error`:
- rerun `$WRANGLER whoami` and re-authenticate.
2. `Object not found`:
- check exact key and prefix from memory manifests.
3. Bucket mismatch:
- verify binding and bucket name in:
  - `/Applications/clawstudy/study-service/wrangler.jsonc`
  - `/Applications/clawstudy/moltworker/wrangler.jsonc`
4. Local command not found:
- run from `/Applications/clawstudy/study-service` and use `export WRANGLER=./node_modules/.bin/wrangler`.
