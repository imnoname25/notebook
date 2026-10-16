"""HTTPS-only GitHub approval metadata. Never connects to Unraid or accepts arbitrary URLs."""
import datetime as dt
import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

from deploy_core import REPOSITORY, checksum, digest, hash_bytes, manifest, require

MAX_BYTES = 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHub:
    def __init__(self, token=None):
        self.token = token

    def request(self, path):
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "notebook-unraid-approval"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        request = urllib.request.Request("https://api.github.com/repos/" + REPOSITORY + path, headers=headers)
        return urllib.request.build_opener(NoRedirect()).open(request, timeout=30)

    def api(self, path):
        with self.request(path) as response:
            raw = response.read(MAX_BYTES + 1)
        require(len(raw) <= MAX_BYTES, "github-response-too-large")
        return json.loads(raw)

    def artifact(self, run_id, name, filename):
        require(re.fullmatch("[1-9][0-9]*", str(run_id)), "invalid-run-id")
        artifacts = self.api(f"/actions/runs/{run_id}/artifacts?per_page=100")
        matches = [a for a in artifacts["artifacts"] if a["name"] == name and not a["expired"]]
        require(len(matches) == 1, "missing-or-ambiguous-artifact")
        entry = matches[0]
        require(entry["size_in_bytes"] <= MAX_BYTES, "artifact-too-large")
        checksum(entry.get("digest", "").removeprefix("sha256:"))
        try:
            with self.request(f"/actions/artifacts/{int(entry['id'])}/zip") as response:
                raw = response.read(MAX_BYTES + 1)
        except urllib.error.HTTPError as error:
            require(error.code == 302, "artifact-download-failed")
            location = error.headers.get("Location", "")
            target = urllib.parse.urlsplit(location)
            require(target.scheme == "https" and target.hostname and target.hostname.endswith((".blob.core.windows.net", ".actions.githubusercontent.com")), "artifact-redirect-denied")
            # Signed blob URL only, without the GitHub Authorization header. Deny further redirects.
            with urllib.request.build_opener(NoRedirect()).open(location, timeout=60) as response:
                raw = response.read(MAX_BYTES + 1)
        require(len(raw) <= MAX_BYTES and "sha256:" + hash_bytes(raw) == entry["digest"], "artifact-digest-mismatch")
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            require(archive.namelist() == [filename], "unexpected-artifact-entries")
            require(archive.getinfo(filename).file_size <= MAX_BYTES, "artifact-entry-too-large")
            return archive.read(filename)

    def run(self, run_id, workflow, branch=None, delivering=False):
        require(re.fullmatch("[1-9][0-9]*", str(run_id)), "invalid-run-id")
        run = self.api(f"/actions/runs/{run_id}")
        require(run["repository"]["full_name"] == REPOSITORY and run["path"] == ".github/workflows/" + workflow, "wrong-workflow")
        if delivering:
            require(run["status"] in ("in_progress", "completed") and run.get("conclusion") in (None, "success"), "workflow-not-deliverable")
            jobs = self.api(f"/actions/runs/{run_id}/attempts/{run['run_attempt']}/jobs?per_page=100")["jobs"]
            require(any(job["name"] == "approve" and job["conclusion"] == "success" for job in jobs), "approval-job-not-successful")
        else:
            require(run["status"] == "completed" and run["conclusion"] == "success", "workflow-not-successful")
        if branch:
            require(run["head_branch"] == branch, "wrong-workflow-branch")
        return run

    def protection(self):
        environment = self.api("/environments/production")
        rules = environment.get("protection_rules", [])
        reviewers = [person["reviewer"]["id"] for rule in rules if rule.get("type") == "required_reviewers" for person in rule.get("reviewers", []) if person.get("type") == "User"]
        require(reviewers, "required-individual-reviewers-required")
        return environment["id"], reviewers

    def manual_approval(self, run_id):
        environment_id, reviewers = self.protection()
        history = self.api(f"/actions/runs/{int(run_id)}/approvals")
        require(any(row.get("state") == "approved" and row.get("user", {}).get("id") in reviewers and any(env.get("id") == environment_id for env in row.get("environments", [])) for row in history), "recorded-environment-review-required")


def build_manifest(github, run_id):
    run = github.run(run_id, "docker-publish.yml")
    require(run["event"] == "push", "tag-push-build-required")
    raw = github.artifact(run_id, "notebook-image-" + run["head_sha"], "image.json")
    value = manifest(json.loads(raw))
    require(value["sha"] == run["head_sha"], "build-sha-mismatch")
    return value, raw


def approved(github, run_id, delivering=False):
    run = github.run(run_id, "unraid-production-approval.yml", "main", delivering=delivering)
    require(run["event"] == "workflow_dispatch", "manual-approval-required")
    value = json.loads(github.artifact(run_id, "approved-unraid-update", "approved-request.json"))
    require(str(value.get("approval_run_id")) == str(run_id), "approval-run-mismatch")
    issued = dt.datetime.fromisoformat(value["issued_at"])
    age = dt.datetime.now(dt.timezone.utc) - issued
    require(dt.timedelta(0) <= age <= dt.timedelta(hours=24), "approval-expired")
    github.manual_approval(run_id)
    candidate, raw = build_manifest(github, value["publish_run_id"])
    require(candidate["image"] == value["image"] and hash_bytes(raw) == value["manifest_sha256"], "approval-build-mismatch")
    return value


def main():
    require(os.environ.get("GITHUB_REPOSITORY") == REPOSITORY and os.environ.get("GITHUB_REF") == "refs/heads/main", "trusted-main-required")
    github = GitHub(os.environ.get("GH_TOKEN"))
    github.protection()
    candidate, raw = build_manifest(github, os.environ["PUBLISH_RUN_ID"])
    previous = digest(os.environ["PREVIOUS_IMAGE"])
    require(previous != candidate["image"], "already-current")
    review_sha = checksum(os.environ["REVIEW_SHA256"])
    preparation = os.environ["PREPARATION_ID"]
    require(re.fullmatch("[0-9a-f]{32}", preparation), "invalid-preparation-id")
    operation = os.environ["OPERATION"]
    require(operation in ("deploy", "rollback"), "invalid-operation")
    if sys.argv[1:] == ["issue"]:
        github.manual_approval(os.environ["GITHUB_RUN_ID"])
        value = {"format": 1, "repository": REPOSITORY, "image": candidate["image"], "previous_image": previous,
                 "manifest_sha256": hash_bytes(raw), "review_sha256": review_sha,
                 "publish_run_id": os.environ["PUBLISH_RUN_ID"], "approval_run_id": os.environ["GITHUB_RUN_ID"],
                 "issued_at": dt.datetime.now(dt.timezone.utc).isoformat(), "operation": operation,
                 "preparation_id": preparation, "control_sha": os.environ["GITHUB_SHA"]}
        Path("approved-request.json").write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    else:
        require(sys.argv[1:] == ["validate"], "invalid-mode")
    print("Approval metadata validated; no production connection was made.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # HTTP bodies/URLs, auth headers and exceptions can contain credentials. Do not print them.
        print("Approval validation failed; check build identity and Environment protection.", file=sys.stderr)
        sys.exit(1)
