#!/usr/bin/env python3
"""Idempotently align remote llm-usage-tracker JSONL into the local tracker."""

from __future__ import annotations

import base64
import datetime as dt
import json
import os
import subprocess
import sys
import time
from pathlib import Path


HOME = Path.home()
TRACKER_HOME = HOME / ".llm-usage-tracker"
USAGE_DIR = TRACKER_HOME / "usage"
STATE_PATH = TRACKER_HOME / "remote-align-state.json"
LOCK_PATH = TRACKER_HOME / "remote-align.lock"
REMOTE_HOSTS = ("home-local", "home")
SOURCE = "home-local"

REMOTE_CODE = r'''
import glob, json, os, sys

state = json.load(sys.stdin)
files = state.get("files", {})
for path in sorted(glob.glob(os.path.expanduser("~/.llm-usage-tracker/usage/usage-*.jsonl"))):
    try:
        size = os.path.getsize(path)
    except OSError:
        continue
    previous = files.get(path, {})
    start = int(previous.get("line", 0))
    if size < int(previous.get("size", 0)):
        start = 0
    line_no = 0
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line_no += 1
                if line_no <= start:
                    continue
                if not line.endswith("\n"):
                    break
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                print(json.dumps({"type": "record", "path": path, "line": line_no, "record": record}, ensure_ascii=False))
    except OSError:
        continue
    print(json.dumps({"type": "cursor", "path": path, "line": line_no, "size": size}, ensure_ascii=False))
'''
REMOTE_CODE_B64 = base64.b64encode(REMOTE_CODE.encode()).decode()


def acquire_lock(timeout: float = 20.0):
    deadline = time.time() + timeout
    while True:
        try:
            LOCK_PATH.mkdir()
            (LOCK_PATH / "pid").write_text(str(os.getpid()), encoding="utf-8")
            return
        except FileExistsError:
            if time.time() >= deadline:
                raise TimeoutError(f"alignment lock is busy: {LOCK_PATH}")
            time.sleep(0.1)


def release_lock():
    try:
        (LOCK_PATH / "pid").unlink(missing_ok=True)
        LOCK_PATH.rmdir()
    except OSError:
        pass


def load_state() -> dict:
    try:
        value = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        if isinstance(value, dict) and isinstance(value.get("files"), dict):
            return value
    except (OSError, json.JSONDecodeError):
        pass
    return {"version": 1, "host": SOURCE, "files": {}}


def remote_records(state: dict):
    last_error = None
    for host in REMOTE_HOSTS:
        command = f"python3 -c 'import base64;exec(base64.b64decode(\"{REMOTE_CODE_B64}\"))'"
        result = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", host, command],
            input=json.dumps(state).encode(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=45,
        )
        if result.returncode != 0:
            last_error = f"{host}: {result.stderr.decode(errors='replace').strip()}"
            continue
        records = []
        cursors = {}
        for raw in result.stdout.splitlines():
            item = json.loads(raw)
            if item.get("type") == "record":
                records.append(item)
            elif item.get("type") == "cursor":
                cursors[item["path"]] = {"line": item["line"], "size": item["size"]}
        return host, records, cursors
    raise RuntimeError(last_error or "no remote host available")


def record_date(record: dict) -> str:
    value = record.get("date")
    if isinstance(value, str) and len(value) >= 10:
        return value[:10]
    timestamp = record.get("timestamp")
    if isinstance(timestamp, str):
        try:
            return dt.datetime.fromisoformat(timestamp.replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            pass
    return dt.date.today().isoformat()


def is_ali_record(record: dict) -> bool:
    provider = str(record.get("provider", "")).lower()
    model = str(record.get("model", "")).lower()
    if provider in {"codex", "openai-codex", "openai", "anthropic", "minimax", "volcengine"}:
        return False
    return provider in {"ali", "alibaba-cn", "zhipu", "qwen", "custom"} or model.startswith(("glm-", "qwen", "deepseek"))


def append_records(records: list[dict]):
    by_date: dict[str, list[dict]] = {}
    for item in records:
        record = dict(item["record"])
        record_id = record.get("id")
        if not record_id or not is_ali_record(record):
            continue
        record["source"] = SOURCE
        by_date.setdefault(record_date(record), []).append(record)

    written = 0
    skipped = 0
    USAGE_DIR.mkdir(parents=True, exist_ok=True)
    for date, entries in by_date.items():
        path = USAGE_DIR / f"usage-{date}.jsonl"
        existing = set()
        if path.exists():
            with path.open(encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    try:
                        value = json.loads(line)
                        if value.get("id"):
                            existing.add(value["id"])
                    except json.JSONDecodeError:
                        continue
        with path.open("a", encoding="utf-8") as fh:
            for record in entries:
                if record["id"] in existing:
                    skipped += 1
                    continue
                fh.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
                existing.add(record["id"])
                written += 1
            fh.flush()
            os.fsync(fh.fileno())
    return written, skipped


def main() -> int:
    acquire_lock()
    try:
        state = load_state()
        host, records, cursors = remote_records(state)
        written, skipped = append_records(records)
        state["host"] = host
        state["lastAlignedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
        state["files"].update(cursors)
        STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary = STATE_PATH.with_suffix(".tmp")
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, STATE_PATH)
        print(json.dumps({"ok": True, "host": host, "remoteRecords": len(records), "written": written, "skipped": skipped}))
        return 0
    finally:
        release_lock()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        raise SystemExit(1)
