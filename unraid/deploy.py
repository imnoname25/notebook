#!/usr/bin/env python3
"""Local Unraid preparation and verification. Intentionally has no apply/recreate/delete command."""
import argparse
import datetime as dt
try:
    import fcntl
except ImportError:  # Pure/mock tests can run on Windows; main refuses non-Linux execution.
    fcntl = None
import json
import io
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
import urllib.parse
import uuid

from approval import GitHub, NoRedirect, approved
from deploy_core import BACKUPS, UPLOADS, StopError, approved_request, digest, hash_bytes, manifest, migration_delta, pinned_template, require, review, runtime, template, template_fingerprint

STAGE = "configuration"
STATE_DIR = None


def run(args, stdin=None, stdout=subprocess.PIPE):
    result = subprocess.run(args, stdin=stdin, stdout=stdout, stderr=subprocess.DEVNULL, timeout=1800, check=False)
    require(result.returncode == 0, "local-command-failed")
    return result.stdout


def inspect(name, kind="container"):
    return json.loads(run(["docker", kind, "inspect", name]))[0]


def save(path, value):
    data = value if isinstance(value, bytes) else (json.dumps(value, indent=2) + "\n").encode()
    # New files only. Never follow or overwrite symlinks or existing receipts.
    fd = open_private(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def open_private(path, flags):
    """Anchor each ancestor with O_NOFOLLOW; application-writable backup parents cannot redirect root writes."""
    path = Path(path).absolute()
    if os.name == "nt":  # Only for filesystem unit tests. main never runs on Windows.
        return os.open(path, flags, 0o600)
    directory = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        parent = os.fstat(directory)
        require(parent.st_uid == os.geteuid() and parent.st_mode & 0o077 == 0, "receipt-parent-not-private")
        return os.open(path.name, flags | os.O_NOFOLLOW, 0o600, dir_fd=directory)
    finally:
        os.close(directory)


def read_private(path):
    with os.fdopen(open_private(path, os.O_RDONLY), "rb") as stream:
        return stream.read()


def private_dir(path):
    require(not path.is_symlink(), "symlink-state-directory")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(path.stat().st_uid == os.geteuid() and path.stat().st_mode & 0o077 == 0, "state-directory-not-private")


def file_hash(path):
    import hashlib
    result = hashlib.sha256()
    with os.fdopen(open_private(path, os.O_RDONLY), "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def migration_files():
    raw = run(["docker", "cp", "notebook:/app/prisma/migrations", "-"])
    require(len(raw) <= 32 * 1024 * 1024, "migration-archive-too-large")
    rows = []
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
        for item in archive:
            parts = item.name.strip("/").split("/")
            require(not item.issym() and not item.islnk() and ".." not in parts, "unsafe-migration-archive")
            if item.isfile() and parts[-1] == "migration.sql":
                require(len(parts) == 3 and parts[0] == "migrations" and re.fullmatch("[a-zA-Z0-9_]+", parts[1]), "invalid-old-migration-name")
                require(item.size <= 8 * 1024 * 1024, "migration-too-large")
                rows.append({"name": parts[1], "sha256": hash_bytes(archive.extractfile(item).read())})
    rows.sort(key=lambda row: row["name"])
    require(rows and len({row["name"] for row in rows}) == len(rows), "missing-or-duplicate-migrations")
    return rows


def config(path):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    for key in ["postgres_container", "database", "database_user", "verification_container", "verification_database", "verification_user"]:
        require(isinstance(value.get(key), str) and re.fullmatch("[a-zA-Z_][a-zA-Z0-9_-]{0,62}", value[key]), "missing-or-invalid-local-configuration")
    require(value["postgres_container"] not in ("notebook", value["verification_container"]) and value["verification_container"] != "notebook", "verification-must-be-separate")
    require(type(value.get("postgres_major")) is int and value["postgres_major"] >= 14, "postgres-major-required")
    for key in ["postgres_socket", "verification_socket"]:
        require(isinstance(value.get(key), str) and value[key].startswith("/") and ".." not in Path(value[key]).parts, "local-socket-required")
    path = Path(value.get("template_path") or "")
    require(path.is_absolute() and path.is_file() and not path.is_symlink(), "existing-template-path-required")
    return value


def pg(config, verification=False):
    prefix = "verification" if verification else "postgres"
    return ["docker", "exec", "-i", "-e", "PGHOSTADDR=", "-e", "PGSERVICE=", config[prefix + "_container"]], ["--no-password", "--host=" + config[prefix + "_socket"], "--username=" + config["verification_user" if verification else "database_user"], "--dbname=" + config["verification_database" if verification else "database"]]


def sql(config, statement, verification=False):
    command, connection = pg(config, verification)
    return run(command + ["psql", *connection, "-X", "--set=ON_ERROR_STOP=1", "-Atc", statement]).decode().strip()


def backup_target(config, production):
    application = inspect("notebook")
    connection = next(item.split("=", 1)[1] for item in application["Config"]["Env"] if item.startswith("DATABASE_URL="))
    url = urllib.parse.urlsplit(connection)
    network = production["NetworkSettings"]["Networks"].get("notebook-net", {})
    aliases = [config["postgres_container"], network.get("IPAddress")] + (network.get("Aliases") or []) + (network.get("DNSNames") or [])
    require(url.scheme in ("postgres", "postgresql") and url.hostname in aliases and urllib.parse.unquote(url.path.lstrip("/")) == config["database"], "database-url-does-not-match-backup-target")
    require(not set(urllib.parse.parse_qs(url.query)) & {"host", "hostaddr", "port", "dbname", "user", "password"}, "database-url-overrides-not-supported")
    require(sql(config, "SHOW port") == str(url.port or 5432), "postgres-port-mismatch")


def isolated_verification(config):
    production = inspect(config["postgres_container"])
    scratch = inspect(config["verification_container"])
    require(scratch["HostConfig"]["NetworkMode"] == "none", "verification-network-must-be-none")
    require(not scratch["HostConfig"].get("Privileged"), "privileged-verification-denied")
    protected = [Path(UPLOADS).resolve(), Path(BACKUPS).resolve()] + [Path(m["Source"]).resolve() for m in production["Mounts"]]
    for mount in scratch["Mounts"]:
        source = Path(mount["Source"]).resolve()
        require(all(source != path and source not in path.parents and path not in source.parents for path in protected), "verification-shares-production-storage")
    for verification in (False, True):
        require(int(sql(config, "SHOW server_version_num", verification)) // 10000 == config["postgres_major"], "postgres-version-mismatch")
    count = sql(config, "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')", True)
    require(count == "0", "verification-database-not-empty")
    backup_target(config, production)


def current(config, stopped=False):
    info = inspect("notebook")
    signature = runtime(info)
    if stopped:
        require(info["State"]["Running"] is False, "stop-notebook-via-unraid-gui-before-backup")
    xml = Path(config["template_path"]).read_bytes()
    template(xml, info)
    return info, xml, signature


def stopped_identity(info):
    return {key: info["State"].get(key) for key in ("Running", "StartedAt", "FinishedAt")}


def prepare(config, args):
    global STAGE, STATE_DIR
    STAGE = "preflight"
    require(args.exclusive_maintenance, "exclusive-maintenance-required")
    candidate_bytes = Path(args.manifest).read_bytes()
    candidate = manifest(json.loads(candidate_bytes))
    previous = digest(args.previous_image)
    require(candidate["image"] != previous, "already-current")
    info, xml, signature = current(config, stopped=True)
    image = inspect(info["Image"], "image")
    require(previous in image.get("RepoDigests", []), "previous-digest-not-in-local-image")
    STAGE = "verification-isolation"
    isolated_verification(config)
    base = Path(BACKUPS) / "deployments"
    require(Path(BACKUPS).is_dir() and not Path(BACKUPS).is_symlink(), "persistent-backup-path-required")
    private_dir(base)
    STATE_DIR = base / uuid.uuid4().hex
    private_dir(STATE_DIR)
    STAGE = "migration-chain"
    old = migration_files()
    delta = migration_delta(old, candidate["migrations"])
    # Compare filesystem migration hashes to database history; reject unresolved/partial histories.
    history_query = 'SELECT migration_name || chr(58) || checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name'
    applied = sql(config, history_query).splitlines()
    failed = sql(config, 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL')
    require(applied == [r["name"] + ":" + r["sha256"] for r in old] and failed == "0", "database-migration-history-mismatch")
    require(sql(config, "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid <> pg_backend_pid()") == "0", "other-database-clients-present")
    STAGE = "database-dump"
    dump = STATE_DIR / "database.dump"
    command, connection = pg(config)
    with os.fdopen(open_private(dump, os.O_WRONLY | os.O_CREAT | os.O_EXCL), "wb") as stream:
        run(command + ["pg_dump", *connection, "--format=custom"], stdout=stream)
        stream.flush()
        os.fsync(stream.fileno())
    require(dump.stat().st_size > 0, "empty-dump")
    STAGE = "restore-verification"
    command, connection = pg(config, True)
    with os.fdopen(open_private(dump, os.O_RDONLY), "rb") as stream:
        run(command + ["pg_restore", "--list"], stdin=stream)
    with os.fdopen(open_private(dump, os.O_RDONLY), "rb") as stream:
        run(command + ["pg_restore", *connection, "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl"], stdin=stream)
    restored = sql(config, history_query, True).splitlines()
    require(restored == applied, "restored-migration-history-mismatch")
    STAGE = "uploads-backup"
    archive = STATE_DIR / "uploads.tar.gz"
    with os.fdopen(open_private(archive, os.O_WRONLY | os.O_CREAT | os.O_EXCL), "wb") as destination:
        with tarfile.open(fileobj=destination, mode="w:gz", dereference=False) as tar:
            tar.add(UPLOADS, arcname="uploads", recursive=True)
    with os.fdopen(open_private(archive, os.O_RDONLY), "rb") as source:
        with tarfile.open(fileobj=source, mode="r:gz") as tar:
            for member in tar:
                if member.isfile():
                    with tar.extractfile(member) as stream:
                        while stream.read(1024 * 1024):
                            pass
    # The application must remain stopped throughout the consistent backup window.
    final, final_xml, final_signature = current(config, stopped=True)
    require(final["Id"] == info["Id"] and stopped_identity(final) == stopped_identity(info) and final_signature == signature and final_xml == xml, "configuration-changed-during-backup")
    state = {"format": 1, "previous_image": previous, "previous_image_id": info["Image"], "candidate_image": candidate["image"],
             "runtime_fingerprint": signature, "template_sha256": hash_bytes(xml), "template_path": config["template_path"], "container_id": info["Id"], "stopped_state": stopped_identity(info),
             "dump_sha256": file_hash(dump), "uploads_sha256": file_hash(archive), "migration_manifest_sha256": hash_bytes(candidate_bytes),
             "new_migrations": [r["name"] for r in delta], "prepared_at": dt.datetime.now(dt.timezone.utc).isoformat()}
    save(STATE_DIR / "original.xml", xml)
    save(STATE_DIR / "image.json", candidate_bytes)
    save(STATE_DIR / "state.json", state)
    review_example = {k: state[k] for k in ["previous_image", "candidate_image", "dump_sha256", "uploads_sha256", "migration_manifest_sha256"]}
    review_example.update(migration_review_passed=False, upgrade_rehearsal_passed=False, rollback_rehearsal_passed=False)
    save(STATE_DIR / "review.example.json", review_example)
    print("Backup restored in isolated verification database. Preparation ID: " + STATE_DIR.name)
    print("Review/rehearsal and GitHub approval still required; no update was applied.")


def load_state(identifier):
    require(re.fullmatch("[0-9a-f]{32}", identifier), "invalid-preparation-id")
    directory = Path(BACKUPS) / "deployments" / identifier
    require(not directory.is_symlink(), "symlink-state-directory")
    state = json.loads(read_private(directory / "state.json"))
    digest(state["candidate_image"])
    digest(state["previous_image"])
    for file, key in [("database.dump", "dump_sha256"), ("uploads.tar.gz", "uploads_sha256"), ("image.json", "migration_manifest_sha256"), ("original.xml", "template_sha256")]:
        require(file_hash(directory / file) == state[key], "backup-or-preparation-integrity-failed")
    return directory, state


def fresh_approval(directory, state):
    review_bytes = read_private(directory / "review.json")
    review(json.loads(review_bytes), state)
    request = json.loads(read_private(directory / "approved.json"))
    approved_request(request, state, hash_bytes(review_bytes))
    now = dt.datetime.now(dt.timezone.utc)
    for field, value in [("approval", request["issued_at"]), ("backup", state["prepared_at"])]:
        age = now - dt.datetime.fromisoformat(value)
        require(dt.timedelta(0) <= age <= dt.timedelta(hours=24), field + "-expired")
    return request


def authorize(config, args):
    global STAGE, STATE_DIR
    STAGE = "approval"
    STATE_DIR, state = load_state(args.preparation)
    info, xml, signature = current(config, stopped=True)
    require(info["Id"] == state["container_id"] and stopped_identity(info) == state["stopped_state"] and info["Image"] == state["previous_image_id"] and signature == state["runtime_fingerprint"] and hash_bytes(xml) == state["template_sha256"], "production-drift-since-preparation")
    review_bytes = read_private(STATE_DIR / "review.json")
    review(json.loads(review_bytes), state)
    token = None
    if args.token_file:
        token_path = Path(args.token_file)
        require(token_path.is_file() and not token_path.is_symlink() and token_path.stat().st_mode & 0o077 == 0, "token-file-not-private")
        token = token_path.read_text().strip()
    request = approved(GitHub(token), args.approval_run)
    approved_request(request, state, hash_bytes(review_bytes))
    STAGE = "stale-backup-guard"
    prepared = dt.datetime.fromisoformat(state["prepared_at"])
    require(dt.timedelta(0) <= dt.datetime.now(dt.timezone.utc) - prepared <= dt.timedelta(hours=24), "backup-too-old")
    final, final_xml, final_signature = current(config, stopped=True)
    require(final["Id"] == info["Id"] and stopped_identity(final) == stopped_identity(info) and final_signature == signature and final_xml == xml, "production-changed-during-approval-check")
    save(STATE_DIR / "approved.json", request)
    save(STATE_DIR / "candidate.xml", pinned_template(xml, state["candidate_image"]))
    save(STATE_DIR / "rollback.xml", pinned_template(xml, state["previous_image"]))
    print("Authorized image: " + state["candidate_image"])
    print("Use existing Unraid Edit → Repository; candidate.xml is a private comparison copy, not an installed template.")


def verify(config, args):
    global STAGE, STATE_DIR
    STAGE = "post-update-health"
    STATE_DIR, state = load_state(args.preparation)
    fresh_approval(STATE_DIR, state)
    desired = state["previous_image"] if args.rollback else state["candidate_image"]
    if args.rollback:
        review(json.loads(read_private(STATE_DIR / "review.json")), state)
    deadline = time.monotonic() + 180
    while True:
        info, xml, signature = current(config)
        image = inspect(info["Image"], "image")
        require(info["Config"]["Image"] == desired and desired in image.get("RepoDigests", []), "wrong-running-image")
        require(signature == state["runtime_fingerprint"], "settings-or-secrets-changed")
        require(template_fingerprint(xml) == template_fingerprint(read_private(STATE_DIR / "original.xml")), "template-settings-changed")
        require(info["State"]["Running"], "application-not-running")
        if info["State"].get("Health", {}).get("Status") == "healthy":
            # Fixed LAN destination, no redirects, no response bodies in diagnostics.
            try:
                with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open("http://192.168.110.11:3100/api/health/ready", timeout=5) as response:
                    if response.status == 200:
                        break
            except Exception:
                pass
        require(time.monotonic() < deadline, "health-timeout")
        time.sleep(3)
    save(STATE_DIR / ("rollback-healthy.json" if args.rollback else "update-healthy.json"), {"healthy": True, "image": desired, "checked_at": dt.datetime.now(dt.timezone.utc).isoformat()})
    print("Image, preserved configuration and readiness verified.")


def main():
    global STAGE, STATE_DIR
    os.umask(0o077)
    require(sys.version_info >= (3, 11), "python-3-11-required")
    require(sys.platform == "linux" and os.geteuid() == 0, "local-unraid-administrator-required")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("preflight")
    prep = sub.add_parser("prepare")
    prep.add_argument("--manifest", required=True)
    prep.add_argument("--previous-image", required=True)
    prep.add_argument("--exclusive-maintenance", action="store_true", required=True)
    auth = sub.add_parser("authorize")
    auth.add_argument("--preparation", required=True)
    auth.add_argument("--approval-run", required=True)
    auth.add_argument("--token-file")
    check = sub.add_parser("verify")
    check.add_argument("--preparation", required=True)
    check.add_argument("--rollback", action="store_true")
    rollback = sub.add_parser("rollback-plan")
    rollback.add_argument("--preparation", required=True)
    args = parser.parse_args()
    require(shutil.which("docker"), "docker-required")
    settings = config(args.config)
    # One shared local lock per invocation. GUI operations are outside this lock and require maintenance discipline.
    fd = os.open("/var/lock/notebook-deployment.lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8") as lock:
        require(os.fstat(lock.fileno()).st_uid == 0, "unsafe-operation-lock")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.command == "preflight":
            info, _, _ = current(settings)
            print("Expected configuration verified. Current image references:")
            for image in inspect(info["Image"], "image").get("RepoDigests", []):
                if re.fullmatch("ghcr.io/imnoname25/notebook@sha256:[0-9a-f]{64}", image):
                    print(image)
        elif args.command == "prepare":
            prepare(settings, args)
        elif args.command == "authorize":
            authorize(settings, args)
        elif args.command == "verify":
            verify(settings, args)
        else:
            STAGE = "rollback-plan"
            STATE_DIR, state = load_state(args.preparation)
            review(json.loads(read_private(STATE_DIR / "review.json")), state)
            fresh_approval(STATE_DIR, state)
            require(state["previous_image"] in inspect(state["previous_image_id"], "image").get("RepoDigests", []), "previous-image-not-cached")
            info, _, signature = current(settings)
            require(info["Config"]["Image"] == state["candidate_image"] and signature == state["runtime_fingerprint"], "rollback-source-drift")
            print("Only after confirming schema and new writes remain backward compatible, set Repository to: " + state["previous_image"])
            print("Otherwise stop and use an explicitly approved database+uploads restore; this tool never restores production or deletes data.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Deliberately no exception text, stderr from Docker, Env, XML, URLs or health output.
        code = str(error) if isinstance(error, StopError) else "unexpected-failure"
        if STATE_DIR and STATE_DIR.is_dir():
            try:
                save(STATE_DIR / ("failure-" + uuid.uuid4().hex + ".json"), {"failed": True, "stage": STAGE, "code": code, "at": dt.datetime.now(dt.timezone.utc).isoformat()})
            except Exception:
                pass
        print("Operation stopped; stage=" + STAGE + "; code=" + code + ". No automatic retry or rollback.", file=sys.stderr)
        sys.exit(1)
