#!/usr/bin/env python3
"""Forced SSH command; trusted local code only. Never checks out or executes repository code."""
import argparse
import base64
import datetime as dt
import json
import os
from pathlib import Path
import re
import sys

import deploy
from approval import GitHub, approved
from deploy_core import StopError, approved_request, hash_bytes, require, review
import executor

CONTROL = Path("/mnt/user/appdata/notebook-deploy-control")
PINNED = (".github/workflows/unraid-production-approval.yml", "unraid/approval.py", "unraid/deploy_core.py")


def private_file(path):
    stat = path.lstat()
    require(not path.is_symlink() and stat.st_uid == 0 and stat.st_mode & 0o077 == 0 and stat.st_nlink == 1, "control-file-not-private")
    return deploy.read_private(path)


def verify_control(github, settings, run_id, request):
    run = github.run(run_id, "unraid-production-approval.yml", "main", delivering=True)
    sha = run["head_sha"]
    require(re.fullmatch("[0-9a-f]{40}", sha) and request.get("control_sha") == sha, "control-sha-mismatch")
    pins = settings.get("trusted_control_hashes", {})
    require(set(pins) == set(PINNED), "reviewed-control-hashes-required")
    for path in PINNED:
        blob = github.api("/contents/" + path + "?ref=" + sha)
        require(blob.get("encoding") == "base64", "unexpected-control-content")
        raw = base64.b64decode(blob["content"])
        require(hash_bytes(raw) == pins[path], "workflow-control-code-not-reviewed")


def dispatch(settings, run_id):
    require(settings.get("execution_enabled") is True, "execution-disabled")
    require(settings.get("approval_mode") == "required-reviewers", "required-reviewers-mode-required")
    token_path = Path(settings["github_token_file"])
    require(token_path == CONTROL / "github-token", "unexpected-token-location")
    github = GitHub(private_file(token_path).decode().strip())
    request = approved(github, run_id, delivering=True)
    verify_control(github, settings, run_id, request)
    require(request.get("operation") in ("deploy", "rollback"), "invalid-operation")
    directory, state = deploy.load_state(request.get("preparation_id", ""))
    deploy.STATE_DIR = directory
    reviewed = deploy.read_private(directory / "review.json")
    review(json.loads(reviewed), state)
    approved_request(request, state, hash_bytes(reviewed))
    # Rehearsal snapshot is separate from the fresh, restore-tested execution backup.
    if request["operation"] == "deploy":
        age = dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(state["prepared_at"])
        require(dt.timedelta(0) <= age <= dt.timedelta(hours=24), "rehearsal-snapshot-expired")
    ledger = CONTROL / "used-runs"
    deploy.private_dir(ledger)
    # O_EXCL consumes the approval BEFORE any stop/pull/recreation. A failed run needs NEW approval.
    deploy.save(ledger / (run_id + ".json"), {"run_id": run_id, "request_sha256": hash_bytes(json.dumps(request, sort_keys=True).encode())})
    executor.execute(settings, directory, state, request)


def command(value):
    require(isinstance(value, str) and re.fullmatch(r"dispatch [1-9][0-9]{0,19}", value), "ssh-command-denied")
    return value.split(" ")[1]


def main():
    os.umask(0o077)
    require(sys.platform == "linux" and sys.version_info >= (3, 11) and os.geteuid() == 0, "local-root-python-3-11-required")
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    sub.add_parser("ssh")
    prep = sub.add_parser("prepare-review")
    prep.add_argument("--manifest", required=True)
    prep.add_argument("--previous-image", required=True)
    args = parser.parse_args()
    # Fixed root-owned location, never a path supplied by the SSH peer.
    profile = CONTROL / "deployment.local.json"
    private_file(profile)
    settings = deploy.config(profile)
    fd = os.open("/var/lock/notebook-deployment.lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "a") as lock:
        require(os.fstat(lock.fileno()).st_uid == 0, "unsafe-operation-lock")
        deploy.fcntl.flock(lock, deploy.fcntl.LOCK_EX | deploy.fcntl.LOCK_NB)
        if args.mode == "ssh":
            dispatch(settings, command(os.environ.get("SSH_ORIGINAL_COMMAND")))
        else:
            executor.prepare_review(settings, Path(args.manifest), args.previous_image)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, StopError) else "operation-failed"
        if deploy.STATE_DIR:
            try:
                deploy.save(deploy.STATE_DIR / ("failure-" + __import__("uuid").uuid4().hex + ".json"), {"code": code, "stage": deploy.STAGE})
            except Exception:
                pass
        print("Notebook operation stopped; code=" + code + ". Inspect private local receipts.", file=sys.stderr)
        sys.exit(1)
