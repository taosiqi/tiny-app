# Product Contracts

## Image engines

- `auto`: use Tinify first when a usable Key exists. With no usable Key, or after all Keys are exhausted, attempt local strict-lossless compression.
- `local`: stay offline and run strict-lossless compression only.
- `tinify`: always use the Tinify API. Pause when no usable Key remains.
- Tinify is external automatic optimization. Do not describe it as strict lossless.
- Local strict-lossless support:
  - PNG and APNG: optimize with `oxipng`; preserve animation chunks.
  - Static WebP: encode with bundled FFmpeg `libwebp -lossless 1`.
  - Animated WebP, JPEG, and AVIF: skip locally with a clear reason directing the user to Tinify.
- Keep only a smaller output. Back up the first original and replace through a sibling temporary file.

## Settings and records

- Current settings image shape: `{ engine, recursiveScan }`.
- Current exported settings format: `{ format: 'tinypress-settings', version: 2, settings }`.
- Reject older exported settings versions. Do not migrate deprecated image-quality fields.
- Current task record key: `tinypress_task_records_v6`. Do not read older keys.
- Persist each record's compression snapshot so results remain diagnosable.

## Task pages

- Image and audio pages accept multiple files and directories and deduplicate paths.
- Clear selected paths after `done` only when `failed === 0 && skipped === 0`.
- Preserve paths after failures or skips. Preserve remaining paths when paused.
- Keep logs, statistics, comparison results, and retry actions after completion.
