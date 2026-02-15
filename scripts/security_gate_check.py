import re
import sys
from pathlib import Path


TRACKER_PATH = Path("SECURITY_REMEDIATION_TRACKER.md")
ROW_RE = re.compile(
    r"^\| (P0-\d{2}) \| [^|]+ \| [^|]+ \| [^|]+ \| (OPEN|IN_PROGRESS|BLOCKED) \|"
)


def main() -> int:
    if not TRACKER_PATH.exists():
        print(f"Missing {TRACKER_PATH}")
        return 1

    blocked = []
    for line in TRACKER_PATH.read_text(encoding="utf-8").splitlines():
        match = ROW_RE.match(line)
        if match:
            blocked.append((match.group(1), match.group(2)))

    if blocked:
        print("Release gate failed: one or more P0 tasks are not DONE.")
        for task_id, status in blocked:
            print(f"- {task_id}: {status}")
        return 1

    print("Security release gate passed: all P0 tasks are DONE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
