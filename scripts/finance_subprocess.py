"""Pass finance questions as data, never as Python source."""
import json
import os
from pathlib import Path
import subprocess
import sys


def validate_query(query):
    if not isinstance(query, str) or not 3 <= len(query.strip()) <= 4000:
        raise ValueError("A finance question must contain 3 to 4000 characters.")
    return query


def run_finance_query(query):
    query = validate_query(query)
    try:
        result = subprocess.run(
            [sys.executable, "-m", "scripts.finance_worker"],
            input=json.dumps({"query": query}),
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=60, shell=False, cwd=Path(__file__).resolve().parent.parent,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
    except subprocess.TimeoutExpired:
        return "Finance research stopped: execution time limit reached."
    if result.returncode:
        return "Finance research failed. Check the server logs and provider configuration."
    if len(result.stdout) > 1_000_000:
        return "Finance research stopped: response too large."
    return result.stdout
