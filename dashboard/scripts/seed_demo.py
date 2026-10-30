#!/usr/bin/env python3
"""Reapply the development-only, idempotent SQL callback. Never calls ingestion APIs."""

import argparse
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description="개발용 Compose DB에만 데모 SQL 콜백을 다시 적용합니다.")
    parser.add_argument("--print-sql", action="store_true", help="DB를 변경하지 않고 SQL을 출력합니다.")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    sql = (root / "dev/sql/afterMigrate__demo.sql").read_bytes()
    if args.print_sql:
        sys.stdout.buffer.write(sql)
        return
    # Keep the password inside the container. It is never interpolated by the host shell.
    command = ["docker", "compose", "-f", "compose-dev.yml", "exec", "-T", "mysql", "sh", "-c",
               'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4 "$MYSQL_DATABASE"']
    subprocess.run(command, cwd=root, input=sql, check=True)
    print("개발 DB의 데모 SQL을 적용했습니다. 기존 버전·태그·활성 선택·같은 날짜 이벤트는 보존합니다.")


if __name__ == "__main__":
    main()
