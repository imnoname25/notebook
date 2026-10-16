"""Per-backup isolated PostgreSQL restore target; never recreates notebook-postgres."""
from contextlib import contextmanager
from pathlib import Path
import time
import uuid

from deploy_core import BACKUPS, require
from engine import Engine


@contextmanager
def manager(settings):
    import deploy
    engine = Engine()
    source = engine.inspect("notebook-postgres")
    identifier = uuid.uuid4().hex
    name = "notebook-verify-" + identifier
    parent = Path(BACKUPS) / "deployments"
    deploy.private_dir(parent)
    root = parent / ("verifier-" + identifier)
    deploy.private_dir(root)
    data = root / "data"
    deploy.private_dir(data)
    specification = {"Image": source["Image"], "Env": ["POSTGRES_DB=notebook_verify", "POSTGRES_USER=postgres", "POSTGRES_HOST_AUTH_METHOD=trust", "PGDATA=/var/lib/postgresql/data"],
                     "Cmd": ["postgres", "-c", "unix_socket_directories=/var/run/postgresql"],
                     "Labels": {"notebook.verifier": identifier},
                     "HostConfig": {"NetworkMode": "none", "Privileged": False, "RestartPolicy": {"Name": "no"},
                                    "Binds": [str(data) + ":/var/lib/postgresql/data:rw"], "SecurityOpt": ["no-new-privileges:true"]}}
    created = False
    try:
        engine.create(name, specification)
        created = True
        engine.start(name)
        deadline = time.monotonic() + 90
        while True:
            try:
                # The official entrypoint starts a temporary server during init. Wait for final PID 1.
                require(deploy.run(["docker", "exec", name, "cat", "/proc/1/comm"]).strip() == b"postgres", "verification-still-initializing")
                deploy.run(["docker", "exec", name, "pg_isready", "--host=/var/run/postgresql", "--username=postgres", "--dbname=notebook_verify"])
                break
            except Exception:
                require(time.monotonic() < deadline, "verification-postgres-not-ready")
                time.sleep(2)
        configured = {**settings, "managed_verification": False, "verification_container": name, "verification_database": "notebook_verify", "verification_user": "postgres", "verification_socket": "/var/run/postgresql", "_managed_verification_source": str(data)}
        yield configured
    finally:
        if created:
            # Only this generated, labelled verifier can be stopped/removed. Bind data is retained privately.
            info = engine.inspect(name)
            require(info["Config"].get("Labels", {}).get("notebook.verifier") == identifier, "verifier-identity-changed")
            engine.stop(name)
            engine.remove_verifier(name, identifier)
