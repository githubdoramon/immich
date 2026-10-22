# Archived upstream workflows

These workflow definitions came from Immich v3.3.5. They are retained here as
reference for upstream integrations, outside `.github/workflows` on `custom` so
GitHub Actions does not execute them from this branch. They include upstream publishing, mobile builds, docs,
translations, repository maintenance and test automation.

This fork runs only
[`build-docker-images.yml`](../workflows/build-docker-images.yml), which builds
the custom server and CPU machine-learning images and publishes them to AWS ECR.
See the [CI setup](../workflows/README.md) for prerequisites and image names.

The `main` branch remains an unmodified upstream mirror and retains the original
workflow files. Disable those workflow registrations in GitHub Actions so syncing
`main` does not run them; keep the ECR workflow on `custom` enabled.

When merging a future upstream release, move any newly introduced upstream
workflows here and check that only the fork's ECR workflow remains active.
The archived definitions can be compared against upstream or restored deliberately;
their local reusable-workflow references are not intended to run from this folder.
