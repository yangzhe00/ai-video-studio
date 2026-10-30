"""Read-only live SQLite inspection plus a restricted online backup/restore rehearsal."""
import os
import pathlib
import shutil
import sqlite3
import stat
import sys
import time
import urllib.parse

if len(sys.argv) != 4:
    raise SystemExit("Usage: python3 verify-live-sqlite.py /absolute/studio.sqlite /absolute/backup-root /absolute/api.env")
database, backup_root, env_file = (pathlib.Path(value) for value in sys.argv[1:])

def private(path: pathlib.Path, directory: bool = False) -> None:
    if not path.is_absolute() or path.is_symlink() or not path.exists():
        raise SystemExit(f"Missing or unsafe path: {path}")
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode & 0o077 or (directory and not path.is_dir()) or (not directory and not path.is_file()):
        raise SystemExit(f"Path permissions/type must be private: {path} ({mode:04o})")

private(database)
private(database.parent, directory=True)
private(backup_root, directory=True)
private(env_file)
for suffix in ("-wal", "-shm"):
    companion = pathlib.Path(str(database) + suffix)
    if companion.exists():
        private(companion)

target = backup_root / f"sqlite-security-rehearsal-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{os.getpid()}"
target.mkdir(mode=0o700)
backup = target / "online-backup.sqlite"
restored = target / "restored.sqlite"
uri = "file:" + urllib.parse.quote(str(database)) + "?mode=ro"
with sqlite3.connect(uri, uri=True) as source, sqlite3.connect(backup) as destination:
    source.backup(destination)
os.chmod(backup, 0o600)
shutil.copyfile(backup, restored)
os.chmod(restored, 0o600)

def inspect(path: pathlib.Path):
    with sqlite3.connect("file:" + urllib.parse.quote(str(path)) + "?mode=ro", uri=True) as connection:
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise SystemExit("Backup or restored copy failed integrity_check")
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        tables = [row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        counts = {name: connection.execute('SELECT COUNT(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0]
                  for name in tables}
        return version, counts

before, after = inspect(backup), inspect(restored)
if before != after:
    raise SystemExit("Backup and restore row counts or schema version differ")
print(f"SQLite online backup and isolated restore verified: schema={before[0]}, tables={len(before[1])}")
print(f"Restricted rehearsal evidence directory: {target}")
