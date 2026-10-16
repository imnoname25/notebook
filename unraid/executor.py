"""Local, locked production transaction. No production PostgreSQL mutations or container deletion."""
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import shutil
import time
from types import SimpleNamespace
import urllib.request
import uuid

import deploy
from approval import NoRedirect
from deploy_core import BACKUPS, UPLOADS, StopError, fingerprint, hash_bytes, pinned_template, require, runtime, template_fingerprint
from engine import Engine, clone_spec

HISTORY = 'SELECT migration_name || chr(58) || checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name'
FAILED = 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL'


def history(settings):
    require(deploy.sql(settings, FAILED) == "0", "unresolved-migration-prevents-rollback")
    return deploy.sql(settings, HISTORY).splitlines()


def capacity(settings):
    size = deploy.sql(settings, "SELECT pg_database_size(current_database())")
    require(size.isdecimal(), "database-size-unavailable")
    uploads = sum(p.lstat().st_size for p in Path(UPLOADS).rglob("*") if p.is_file() and not p.is_symlink())
    # Conservative reserve for dump + restore data + indexes, archive and growth. Never prune for space.
    require(shutil.disk_usage(BACKUPS).free >= int(size) * 3 + uploads * 2 + 1024 ** 3, "insufficient-backup-space")


def postgres_guard(settings):
    info = deploy.inspect("notebook-postgres")
    require(settings["postgres_container"] == "notebook-postgres" and info["Name"] == "/notebook-postgres" and info["State"]["Running"], "production-postgres-identity")
    require(info["Config"]["Image"] == "postgres:17-alpine", "production-postgres-image-drift")
    mounts = [(m["Source"], m["Destination"]) for m in info["Mounts"]]
    require(("/mnt/user/appdata/note/postgres", "/var/lib/postgresql/data") in mounts, "production-postgres-mount-drift")
    path = Path(settings["postgres_template_path"])
    require(path.is_file() and not path.is_symlink(), "postgres-template-required")
    return fingerprint({"id": info["Id"], "image": info["Image"], "config": info["Config"], "host": info["HostConfig"], "mounts": info["Mounts"], "template": hash_bytes(path.read_bytes())})


def install_template(settings, expected, replacement):
    path = Path(settings["template_path"])
    require(not path.is_symlink() and path.read_bytes() == expected, "template-changed-before-install")
    temporary = path.with_name(".notebook-deploy-" + uuid.uuid4().hex)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(replacement)
        stream.flush()
        os.fsync(stream.fileno())
    require(path.read_bytes() == expected, "template-changed-during-install")
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def healthy(settings, image, signature, original_xml, timeout=180):
    deadline = time.monotonic() + timeout
    while True:
        info, xml, actual = deploy.current(settings)
        require(info["Config"]["Image"] == image and image in deploy.inspect(info["Image"], "image").get("RepoDigests", []), "unexpected-image")
        require(actual == signature and template_fingerprint(xml) == template_fingerprint(original_xml), "configuration-not-preserved")
        require(info["State"]["Running"], "application-exited")
        if info["State"].get("Health", {}).get("Status") == "healthy":
            try:
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
                with opener.open("http://192.168.110.11:3100/api/health/ready", timeout=5) as response:
                    if response.status == 200:
                        return
            except Exception:
                pass
        require(time.monotonic() < deadline, "health-timeout")
        time.sleep(3)


def snapshot(settings, manifest_path, previous, rollback=False):
    return deploy.prepare(settings, SimpleNamespace(manifest=str(manifest_path), previous_image=previous, exclusive_maintenance=True, rollback_snapshot=rollback))


def prepare_review(settings, manifest_path, previous):
    """Stop only for consistent verified backup; resume the unchanged image for human review."""
    engine = Engine()
    info, _, _ = deploy.current(settings)
    require(info["State"]["Running"] and info["State"].get("Health", {}).get("Status") == "healthy", "healthy-source-required")
    protected = postgres_guard(settings)
    capacity(settings)
    engine.stop("notebook")
    try:
        return snapshot(settings, manifest_path, previous)
    finally:
        engine.start("notebook")
        require(postgres_guard(settings) == protected, "postgres-changed")


def execute(settings, directory, state, request):
    """All callers must hold the host lock and validate independent GitHub approval first."""
    require(settings.get("execution_enabled") is True, "execution-disabled")
    deploy.STAGE = "execution-preflight"
    rollback = request["operation"] == "rollback"
    desired = state["previous_image"] if rollback else state["candidate_image"]
    source = state["candidate_image"] if rollback else state["previous_image"]
    engine = Engine()
    info, xml, signature = deploy.current(settings)
    require(signature == state["runtime_fingerprint"] and template_fingerprint(xml) == template_fingerprint(deploy.read_private(directory / "original.xml")), "production-settings-drift")
    require(info["State"]["Running"] and info["State"].get("Health", {}).get("Status") == "healthy", "healthy-source-required")
    require(source in engine.image(info["Image"]).get("RepoDigests", []), "production-image-drift")
    if rollback:
        require(info["Config"]["Image"] == source, "rollback-source-image-drift")
    # Registry authentication stays in the local root Docker credential store, never in arguments/logs.
    deploy.run(["docker", "pull", desired], stdout=subprocess.DEVNULL)
    require(desired in engine.image(desired).get("RepoDigests", []), "pulled-digest-mismatch")
    if not rollback:
        manifest = json.loads(deploy.read_private(directory / "image.json"))
        require(engine.image(desired)["Config"].get("Labels", {}).get("org.opencontainers.image.revision") == manifest["sha"], "image-source-mismatch")
    specification = clone_spec(info, desired)
    protected = postgres_guard(settings)
    capacity(settings)
    if rollback:
        require(history(settings) == state["database_history"], "schema-changed-manual-database-recovery-required")
    engine.stop("notebook")
    try:
        # A NEW dump and real isolated restore immediately precede every replacement.
        fresh_id = snapshot(settings, directory / "image.json", source, rollback=rollback)
        fresh_dir, fresh = deploy.load_state(fresh_id)
        require(fresh["runtime_fingerprint"] == signature, "settings-changed-during-backup")
        if not rollback:
            require(fresh["database_history"] == state["database_history"], "schema-changed-since-rehearsal")
        deploy.save(fresh_dir / "approval-source.json", {"approval_run_id": request["approval_run_id"], "reviewed_preparation": directory.name, "operation": request["operation"]})
        deploy.save(fresh_dir / "container-private.json", info)
    except Exception:
        # No new image has started and no application migrations have run.
        engine.start("notebook")
        require(postgres_guard(settings) == protected, "postgres-changed")
        raise
    retained = "notebook-retained-" + fresh_id
    created = False
    renamed = False
    installed = xml
    try:
        deploy.STAGE = "container-handoff"
        deploy.save(fresh_dir / "replacement-started.json", {"retained": retained, "target": desired})
        engine.rename("notebook", retained)
        renamed = True
        engine.disable_restart(retained)
        engine.disconnect(retained)
        engine.create("notebook", specification)
        created = True
        require(runtime(engine.inspect("notebook")) == signature, "docker-create-settings-not-preserved")
        installed = pinned_template(xml, desired)
        install_template(settings, xml, installed)
        deploy.STAGE = "candidate-start-and-health"
        engine.start("notebook")
        healthy(settings, desired, signature, xml)
        require(postgres_guard(settings) == protected, "postgres-changed")
        deploy.save(fresh_dir / "success.json", {"image": desired, "operation": request["operation"], "checked_at": dt.datetime.now(dt.timezone.utc).isoformat()})
        print("Production image and health verified; transaction=" + fresh_id)
    except Exception:
        deploy.STAGE = "failure-and-rollback-guard"
        if created:
            engine.stop("notebook")
            failed = "notebook-failed-" + fresh_id
            engine.rename("notebook", failed)
            engine.disable_restart(failed)
            engine.disconnect(failed)
        require(postgres_guard(settings) == protected, "postgres-changed-no-automatic-recovery")
        # Migration errors, including partially applied SQL, forbid an automatic old-app start.
        safe = history(settings) == fresh["database_history"]
        if renamed and safe:
            engine.create("notebook", clone_spec(info, source))
            require(runtime(engine.inspect("notebook")) == signature, "rollback-settings-not-preserved")
            restored_xml = pinned_template(xml, source)
            install_template(settings, installed, restored_xml)
            engine.start("notebook")
            healthy(settings, source, signature, xml)
            deploy.save(fresh_dir / "automatic-rollback.json", {"image": source, "healthy": True})
        require(postgres_guard(settings) == protected, "postgres-changed")
        raise StopError("update-failed-review-private-transaction-" + fresh_id) from None
