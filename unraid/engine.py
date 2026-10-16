"""Docker Engine over a local Unix socket. No TCP listener and no shell-built docker run."""
import copy
import http.client
import json
import re
import socket
import urllib.parse

from deploy_core import fingerprint, require

ENDPOINT_KEYS = ("IPAMConfig", "Links", "Aliases", "MacAddress", "DriverOpts", "GwPriority")


def endpoints(info):
    result = {}
    for name, value in info["NetworkSettings"]["Networks"].items():
        endpoint = {key: copy.deepcopy(value[key]) for key in ENDPOINT_KEYS if key in value and value[key] is not None}
        if "Aliases" in endpoint:
            # Docker generates an ID alias on each create; user aliases remain exact.
            endpoint["Aliases"] = [a for a in endpoint["Aliases"] if a not in (info["Id"], info["Id"][:12])]
        result[name] = endpoint
    return result


def settings_fingerprint(info):
    config = copy.deepcopy(info["Config"])
    config.pop("Image", None)
    config["Env"] = sorted(config.get("Env") or [])
    mounts = sorted((m["Type"], m["Source"], m["Destination"], m.get("RW"), m.get("Propagation", "")) for m in info["Mounts"])
    return fingerprint({"config": config, "host": info["HostConfig"], "mounts": mounts, "networks": endpoints(info)})


def clone_spec(info, image):
    require(info["Name"] == "/notebook", "only-notebook-can-be-cloned")
    require(not info["HostConfig"].get("AutoRemove") and not info["HostConfig"].get("ContainerIDFile"), "unsupported-container-lifecycle")
    require(all(m["Type"] == "bind" for m in info["Mounts"]), "non-bind-mount-needs-explicit-adapter")
    config = copy.deepcopy(info["Config"])
    config["Image"] = image
    config["HostConfig"] = copy.deepcopy(info["HostConfig"])
    config["NetworkingConfig"] = {"EndpointsConfig": endpoints(info)}
    return config


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__("localhost", timeout=60)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.path)


class Engine:
    def __init__(self, path="/var/run/docker.sock"):
        self.path = path
        version = self.request("GET", "/version", versioned=False)["ApiVersion"]
        require(re.fullmatch(r"[0-9]+\.[0-9]+", version) and tuple(map(int, version.split("."))) >= (1, 43), "docker-api-too-old")
        self.prefix = "/v" + version

    def request(self, method, path, body=None, versioned=True):
        connection = UnixConnection(self.path)
        try:
            encoded = None if body is None else json.dumps(body).encode()
            connection.request(method, (self.prefix if versioned else "") + path, body=encoded, headers={"Content-Type": "application/json"})
            response = connection.getresponse()
            raw = response.read(8 * 1024 * 1024 + 1)
            require(len(raw) <= 8 * 1024 * 1024, "docker-response-too-large")
            require(200 <= response.status < 300, "docker-api-request-failed")
            return json.loads(raw) if raw else None
        finally:
            connection.close()

    def inspect(self, name):
        return self.request("GET", "/containers/" + urllib.parse.quote(name, safe="") + "/json")

    def image(self, reference):
        return self.request("GET", "/images/" + urllib.parse.quote(reference, safe="") + "/json")

    def owned(self, name):
        require(name == "notebook" or re.fullmatch(r"notebook-(retained|failed|verify)-[0-9a-f]{32}", name), "container-mutation-not-allowed")
        info = self.inspect(name)
        require(info["Name"] == "/" + name, "container-identity-changed")
        return info

    def stop(self, name):
        info = self.owned(name)
        if info["State"]["Running"]:
            self.request("POST", "/containers/" + info["Id"] + "/stop?t=30")

    def start(self, name):
        info = self.owned(name)
        self.request("POST", "/containers/" + info["Id"] + "/start")

    def rename(self, name, target):
        info = self.owned(name)
        require(target == "notebook" or re.fullmatch(r"notebook-(retained|failed)-[0-9a-f]{32}", target), "invalid-retained-name")
        self.request("POST", "/containers/" + info["Id"] + "/rename?name=" + target)

    def disable_restart(self, name):
        info = self.owned(name)
        require(name.startswith(("notebook-retained-", "notebook-failed-")), "cannot-change-live-restart-policy")
        self.request("POST", "/containers/" + info["Id"] + "/update", {"RestartPolicy": {"Name": "no", "MaximumRetryCount": 0}})

    def disconnect(self, name):
        info = self.owned(name)
        require(not info["State"]["Running"], "disconnect-requires-stopped-container")
        for network in info["NetworkSettings"]["Networks"]:
            self.request("POST", "/networks/" + urllib.parse.quote(network, safe="") + "/disconnect", {"Container": info["Id"], "Force": False})

    def create(self, name, specification):
        require(name == "notebook" or re.fullmatch(r"notebook-verify-[0-9a-f]{32}", name), "container-create-not-allowed")
        return self.request("POST", "/containers/create?name=" + name, specification)["Id"]

    def remove_verifier(self, name, label):
        info = self.owned(name)
        require(name == "notebook-verify-" + label and info["Config"].get("Labels", {}).get("notebook.verifier") == label, "not-an-owned-verifier")
        require(not info["State"]["Running"], "verifier-must-be-stopped")
        self.request("DELETE", "/containers/" + info["Id"] + "?v=false&force=false")
