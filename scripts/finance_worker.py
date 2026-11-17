"""Fixed subprocess entry point. No eval/exec or generated source code."""
import asyncio
import json
import sys
from scripts.finance_subprocess import validate_query


def main():
    raw = sys.stdin.read(65537)
    if len(raw) > 65536:
        raise ValueError("Request too large.")
    payload = json.loads(raw)
    if not isinstance(payload, dict) or set(payload) != {"query"}:
        raise ValueError("Invalid finance request.")
    query = validate_query(payload["query"])
    # Defer provider imports until after validating the input contract.
    from scripts.yahoo_mcp import finance_research
    asyncio.run(finance_research(query))


if __name__ == "__main__":
    main()
