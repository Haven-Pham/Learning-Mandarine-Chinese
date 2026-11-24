"""Shared JSON loader for tools/build_*.py with clear file + line error reporting."""
import json, os, sys


def load_json(path):
    """Read and parse a UTF-8 JSON file; exit with a clear message showing file, line, column, and snippet on error."""
    try:
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
    except OSError as e:
        print(f"LỖI đọc file JSON: {path}\n  {e}", file=sys.stderr)
        sys.exit(1)
    except UnicodeDecodeError as e:
        print(f"LỖI mã hóa UTF-8 trong file JSON: {path}\n  {e}", file=sys.stderr)
        sys.exit(1)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        lines = raw.splitlines()
        line_txt = lines[e.lineno - 1] if 1 <= e.lineno <= len(lines) else ""
        caret = " " * max(e.colno - 1, 0) + "^"
        rel = os.path.basename(path)
        print(
            f"LỖI JSON hỏng: {rel} (dòng {e.lineno}, cột {e.colno}): {e.msg}\n"
            f"  Đường dẫn: {path}\n"
            f"  {e.lineno:4d} | {line_txt}\n"
            f"       | {caret}",
            file=sys.stderr,
        )
        sys.exit(1)
