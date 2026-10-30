"""npm 라이브러리용 정책 모듈·골든 벡터가 현재 서버 규칙·정책과 같은지 확인한다.

실패하면 `python scripts/export_rules_bundle.py` 로 다시 만들고,
packages/prompt-guard-rules 의 `npm test` 로 JS 포팅도 같은 결과인지 확인한다.
"""

import importlib.util

from tests.conftest import ROOT


def test_exported_bundle_is_up_to_date():
    spec = importlib.util.spec_from_file_location("export_rules_bundle",
                                                  ROOT / "scripts/export_rules_bundle.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for path, body in mod.build().items():
        assert path.exists() and path.read_text(encoding="utf-8") == body, (
            f"{path.name} 가 오래되었습니다. python scripts/export_rules_bundle.py 를 실행하세요.")
