#!/usr/bin/env python3
"""Apply a SQL migration file to Supabase via Management API."""
from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("Install requests: pip install requests")
    sys.exit(1)

PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF", "xgwjcknpkpzsbjvuninm")
TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")


def run_query(session: requests.Session, query: str, label: str) -> None:
    print(label)
    response = session.post(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        json={"query": query},
        timeout=120,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"HTTP {response.status_code}: {response.text[:2000]}")


def main() -> int:
    if not TOKEN:
        print("Set SUPABASE_ACCESS_TOKEN")
        return 1

    migration = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
        "supabase/migrations/20260708000000_fix_geofence_and_location_status.sql"
    )
    sql = migration.read_text(encoding="utf-8")

    session = requests.Session()
    session.headers.update(
        {
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        }
    )

    run_query(session, sql, f"Applying {migration.name}...")
    print("Migration applied successfully")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        print(f"Migration failed: {error}")
        raise SystemExit(1)
