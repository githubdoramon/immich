---
title: Custom fork maintenance
description: Local extensions and the v3.3.5 upstream integration
---

This fork integrates upstream [v3.3.5](https://github.com/immich-app/immich/releases/tag/v3.3.5)
(commit `8303cb117e197c700332b33b61b45314c9cc5bb4`) over the previous custom branch
(`9786ce809`). The previous upstream base was `22b43bf4d`, reporting version 2.5.6.
Use release tags for future integrations so dependency locks, container digests,
database migrations, API clients, web, mobile, CLI and machine learning advance together.

## Fork extensions

- [Webhooks](./webhooks.md): `IMMICH_WEBHOOKS_CONFIG`, dynamic event listeners,
  background delivery jobs, configurable headers, timeouts and exponential retry.
  Delivery failures propagate to BullMQ; webhook jobs are excluded from job-event
  subscriptions to prevent recursive delivery. Failure logs and queue inspection omit
  webhook credentials. Startup listeners are active before configuration initialization.
- Person create/update/delete notifications from API actions, recognition, imported
  metadata, thumbnail changes, migration, cleanup and merges.
- `POST /api/faces/identify`: multipart `file`, authenticated with `face.read`,
  returning detected bounds, image dimensions and `personId`, without names or
  person details. Matching remains limited to assets owned by the caller, even
  when other users share a cluster group. Locked assets are included only with an
  elevated session, and soft-deleted faces are excluded. Files are limited to 20 MiB and removed
  after processing, including disabled recognition and ML errors.
- `linux/amd64` builds in `docker/docker-compose.prod.yml` for server and ML.

The old branch retained the identification controller but had lost its service
implementation during an earlier integration. This upgrade restores it.

## Image CI

The fork's only active GitHub Actions workflow builds the server and CPU ML images
for `linux/amd64` and publishes them to AWS ECR on pushes to `custom`. See the
[workflow setup](https://github.com/githubdoramon/immich/blob/custom/.github/workflows/README.md)
for AWS secrets, repository names, tags and deployment references. Upstream
workflows are preserved in `.github/upstream-workflows` on `custom`. Disable the
inherited workflow registrations in GitHub so they also stay inactive when clean
`main` is updated.

## Person identity compatibility

Upstream now identifies a person by `(ownerId, personGroupId)`. Existing IDs are
preserved by upstream's cluster-group migration, which copies the old `person.id`
into `personGroupId`. Webhook `person.id` and `previous.id` remain aliases for
`personGroupId`; `ownerId` distinguishes each user's record. New group merges can
change the group ID as they do in upstream's API.

Webhook person snapshots contain that owner's fields. Sharing projections
(`otherPeople`, `sharedBy`, `sharedWith`) are omitted. Deletion events use complete
rows returned by the successful database deletion; creation and update events
retain the `person`, `previous` (updates only), and `actorId` envelope.

## Deploying this integration

The release includes CA trust updates, patched Node container bases and
`certifi==2026.10.19`. Rebuild **both** custom server and ML images to receive these
changes. Pulling upstream server images would omit the fork extensions.

Before deployment, follow the [v3 migration guide](https://immich.app/blog/v3-migration)
and [upgrading instructions](https://docs.immich.app/install/upgrading/), back up
the database and asset files, and test the real database upgrade in staging.
In particular, v3 drops pgvecto.rs support; an instance still using it must migrate
to VectorChord first. Preserve the actual installation's database volume, upload
mounts and webhook JSON configuration. The configuration path must exist inside
the server container, so retain its bind mount and environment variable in the
installation's Compose override.

Stop/drain background workers before changing application versions so queued
jobs carrying the old person IDs do not execute against the new group-based job
contracts. Keep the old image tags and the pre-upgrade database backup together;
rolling back the application alone after database migrations is unsupported.

After deploying the custom images, verify the reported server version, migration
logs, a person create/update/delete webhook and an identification upload against
the actual ML service. Local tests mock ML detection and HTTP destinations; they
do not establish live inference or production delivery.

## Future integrations

Keep `main` as an unmodified upstream mirror and `custom` as the default branch
containing our extensions and publishing workflow. Fast-forward `main` to the
selected upstream release, then merge `main` into an integration branch created
from `custom`. Resolve changes to these extensions using the new upstream APIs,
then inspect `git diff <tag>` to keep the custom surface small. Merge the reviewed
integration back into `custom`; custom changes must not be merged into `main`.
Run server type checking, lint, formatting, unit
and relevant database integration tests. Rebuild the SDK and plugin SDK before
the server. Regenerate OpenAPI and the TypeScript/Dart clients after API changes
using the tasks in `mise.toml`.
