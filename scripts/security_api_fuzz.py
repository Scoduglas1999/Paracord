#!/usr/bin/env python3
"""API fuzz smoke runner for auth and file-facing endpoints.

Purpose: send malformed/unexpected payloads and assert the server does not
return 5xx responses for routine invalid input.
"""

from __future__ import annotations

import argparse
import random
import string
import sys
from typing import Any

import requests


def rand_str(n: int) -> str:
    alphabet = string.ascii_letters + string.digits + "_-"
    return "".join(random.choice(alphabet) for _ in range(n))


def weird_payload() -> Any:
    candidates: list[Any] = [
        {},
        {"x": rand_str(8)},
        {"email": "not-an-email", "password": ""},
        {"email": f"{rand_str(8)}@example.com", "password": rand_str(2)},
        {"username": rand_str(300), "password": rand_str(64)},
        {"public_key": "deadbeef", "nonce": rand_str(8), "timestamp": -1, "signature": rand_str(16)},
        {"nested": {"a": {"b": {"c": [1, 2, {"d": rand_str(32)}]}}}},
        [],
        ["x", 1, {"y": True}],
        rand_str(2048),
        None,
        12345,
    ]
    return random.choice(candidates)


def request(base_url: str, method: str, path: str, payload: Any) -> requests.Response:
    headers = {"Content-Type": "application/json"}
    return requests.request(
        method=method,
        url=f"{base_url}{path}",
        headers=headers,
        json=payload,
        timeout=8,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--iterations", type=int, default=60)
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    iterations = max(1, args.iterations)

    endpoints = [
        ("POST", "/api/v1/auth/login"),
        ("POST", "/api/v1/auth/register"),
        ("POST", "/api/v1/auth/verify"),
        ("POST", "/api/v1/auth/refresh"),
        ("POST", "/api/v1/auth/attach-public-key"),
    ]

    failures: list[str] = []
    for i in range(iterations):
        method, path = random.choice(endpoints)
        payload = weird_payload()
        try:
            response = request(base_url, method, path, payload)
        except requests.RequestException as exc:
            failures.append(f"iteration={i} endpoint={path} error={exc}")
            continue

        if response.status_code >= 500:
            failures.append(
                f"iteration={i} endpoint={path} status={response.status_code} body={response.text[:200]}"
            )

    if failures:
        print("API fuzz smoke failed:")
        for failure in failures:
            print(f" - {failure}")
        return 1

    print(f"API fuzz smoke passed ({iterations} iterations, no 5xx responses).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
