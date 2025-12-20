# WildShape

## Build Fix Context

The most recent build failure (`Identifier "startBatch" has already been declared`) was caused by two copies of the batch-add and summons helper functions being present in `src/main.js`. Vite/Rollup treats these duplicate function declarations as an error and stops the build. The fix removed the redundant second copy of those functions while leaving the original implementations intact. No functionality was intentionally removed—only duplicate definitions were deleted so the file now contains a single authoritative version of each batch and summons helper.
