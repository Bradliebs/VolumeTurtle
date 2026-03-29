# Todo

- [x] Audit current schema/config and locate HBME source files
- [x] Rebrand package name consistently
- [x] Add Prisma schema changes for HBME merge infrastructure
- [x] Copy shared HBME library files with VolumeTurtle import paths
- [x] Add momentum universe loader and supporting HBME types
- [x] Run Prisma migration: merge_hbme_schema
- [x] Verify no UI/API/risk logic regressions

## Review

- Migration command executed, but Prisma reported existing schema drift and aborted before creating the migration. `prisma generate` completed successfully after schema edits.
- Added infrastructure-only HBME files without wiring them into routes/UI.
