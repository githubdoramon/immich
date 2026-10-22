# Fork image publishing

`build-docker-images.yml` is the only active workflow for this fork. Like Digital
Brain, it configures AWS access-key credentials, logs in to ECR, and uses Docker
Buildx with GitHub Actions caching. Every push to `main` builds both images.
Manual runs also build both images and must select `main`. Pull requests and
other branches cannot publish images.

## AWS setup

Add these **repository secrets** under Settings → Secrets and variables → Actions:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_ACCOUNT_ID` (12 digits)

GitHub cannot retrieve or copy secret values from Digital Brain. Add the same
values here, provided that IAM principal can push to the Immich repositories.
The configured account is checked before publishing.

The default region is `eu-central-1`, matching Digital Brain. Optional repository
**variables** can override the destinations:

| Variable                | Default                              |
| ----------------------- | ------------------------------------ |
| `AWS_REGION`            | `eu-central-1`                       |
| `ECR_SERVER_REPOSITORY` | `appcalipse/immich-server`           |
| `ECR_ML_REPOSITORY`     | `appcalipse/immich-machine-learning` |

Both ECR repositories must already exist in that account and region. The workflow
checks their existence before building. An administrator can create missing ones:

```sh
aws ecr create-repository --region eu-central-1 --repository-name appcalipse/immich-server
aws ecr create-repository --region eu-central-1 --repository-name appcalipse/immich-machine-learning
```

The credentials need `ecr:GetAuthorizationToken` on `*`, plus these permissions
on the two repository ARNs:

```text
ecr:DescribeRepositories
ecr:BatchCheckLayerAvailability
ecr:GetDownloadUrlForLayer
ecr:BatchGetImage
ecr:InitiateLayerUpload
ecr:UploadLayerPart
ecr:CompleteLayerUpload
ecr:PutImage
```

Repositories must allow the moving tags `latest` and `main` to be updated.
Each build also publishes `commit-<full-git-sha>` for a fixed deployment reference.
Use an ECR lifecycle policy for retention; the workflow does not delete older
images or untagged manifest data.

## Published images

With the defaults, the two images are:

```text
<AWS_ACCOUNT_ID>.dkr.ecr.eu-central-1.amazonaws.com/appcalipse/immich-server:latest
<AWS_ACCOUNT_ID>.dkr.ecr.eu-central-1.amazonaws.com/appcalipse/immich-machine-learning:latest
```

Both target `linux/amd64`; machine learning uses `DEVICE=cpu`, matching
`docker/docker-compose.prod.yml`. The server build includes the web UI, CLI,
SDKs and core plugins from this fork. GPU variants and mobile apps are not built.
The Actions run summary includes each image's commit tag and digest.

Publishing does not deploy the images. Set your installation's server and ML
image references to these ECR URLs (prefer matching commit tags) and authenticate
the deployment host to ECR before pulling. Follow the
[upgrade notes](../../docs/docs/developer/custom-fork.md#deploying-this-integration)
before updating the running application or database.

Upstream CI is preserved in [`.github/upstream-workflows`](../upstream-workflows).
Keep `main` as the repository's default branch so manual dispatch uses this
workflow and scheduled workflows are not read from the old `custom` branch.
After pushing this change, switch the default branch in Settings → General →
Default branch, or run:

```sh
gh repo edit githubdoramon/immich --default-branch main
```

Newly introduced upstream workflows must be archived during future merges.
