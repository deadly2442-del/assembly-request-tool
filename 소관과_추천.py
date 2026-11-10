"""국회 요구 문항의 소관 과를 배분기준표에서 찾는 간단한 함수.

확정 처리지침 제3장에 따라 제외어를 먼저 적용하고, 일치한 규칙 중
우선순위 숫자가 가장 큰 과를 반환한다. 최고 우선순위가 동순위이거나
일치하는 규칙이 없으면 '확인필요'를 반환한다.
"""

from __future__ import annotations

import csv
import re
from functools import lru_cache
from pathlib import Path


기본_데이터_폴더 = Path(__file__).resolve().parent / "data"
기본_조직도 = 기본_데이터_폴더 / "A부_조직도_26개과.csv"
기본_배분기준표 = 기본_데이터_폴더 / "배분기준표_소관키워드_304건.csv"


def _문자열_정리(값: str) -> str:
    """대소문자와 공백 표기 차이만 없애 비교한다."""
    return re.sub(r"\s+", "", 값).casefold()


def _나누기(값: str) -> tuple[str, ...]:
    """배분기준표의 쉼표 또는 | 구분값을 나눈다."""
    return tuple(항목.strip() for 항목 in re.split(r"[,|]", 값 or "") if 항목.strip())


@lru_cache(maxsize=None)
def _자료_읽기(
    조직도_경로: str, 배분기준표_경로: str
) -> tuple[frozenset[str], tuple[dict[str, str], ...]]:
    with open(조직도_경로, encoding="utf-8-sig", newline="") as 파일:
        부서 = frozenset(행["과"].strip() for 행 in csv.DictReader(파일))

    with open(배분기준표_경로, encoding="utf-8-sig", newline="") as 파일:
        규칙 = tuple(csv.DictReader(파일))

    조직도_밖 = sorted({행["과"].strip() for 행 in 규칙} - 부서)
    if 조직도_밖:
        raise ValueError(f"배분기준표에 조직도 밖 부서가 있습니다: {조직도_밖}")
    return 부서, 규칙


def 소관과_추천(
    요구문항: str,
    *,
    조직도_경로: str | Path = 기본_조직도,
    배분기준표_경로: str | Path = 기본_배분기준표,
) -> dict[str, object]:
    """요구 문항 하나의 판정과 근거를 반환한다."""
    if not isinstance(요구문항, str) or not 요구문항.strip():
        raise ValueError("요구문항은 빈 문자열일 수 없습니다.")

    _, 규칙들 = _자료_읽기(str(Path(조직도_경로).resolve()), str(Path(배분기준표_경로).resolve()))
    문항 = _문자열_정리(요구문항)
    일치: list[dict[str, object]] = []

    for 규칙 in 규칙들:
        키워드 = 규칙["키워드"].strip()
        if not 키워드 or _문자열_정리(키워드) not in 문항:
            continue
        제외어 = _나누기(규칙.get("제외어", ""))
        if any(_문자열_정리(어휘) in 문항 for 어휘 in 제외어):
            continue
        일치.append(
            {
                "rule_id": 규칙["rule_id"],
                "과": 규칙["과"].strip(),
                "유형": 규칙["유형"].strip(),
                "키워드": 키워드,
                "우선순위": int(규칙["우선순위"]),
            }
        )

    if not 일치:
        return {"판정": "확인필요", "1순위": "확인필요", "후보": [], "근거": []}

    최고_우선순위 = max(int(항목["우선순위"]) for 항목 in 일치)
    최고_규칙 = [항목 for 항목 in 일치 if 항목["우선순위"] == 최고_우선순위]
    후보 = sorted({str(항목["과"]) for 항목 in 최고_규칙})

    if len(후보) != 1:
        return {"판정": "확인필요", "1순위": "확인필요", "후보": 후보, "근거": 최고_규칙}
    return {"판정": "자동추천", "1순위": 후보[0], "후보": 후보, "근거": 최고_규칙}


def 소관과_찾기(요구문항: str) -> str:
    """간단 사용용 함수: 소관 과 또는 '확인필요'를 반환한다."""
    return str(소관과_추천(요구문항)["1순위"])


def _시험(시험_경로: Path = 기본_데이터_폴더 / "시험_요구문항_40건.csv") -> tuple[int, int]:
    with open(시험_경로, encoding="utf-8-sig", newline="") as 파일:
        시험항목 = tuple(csv.DictReader(파일))
    정답_수 = sum(소관과_찾기(항목["요구내용"]) == 항목["정답_배분과"] for 항목 in 시험항목)
    return 정답_수, len(시험항목)


if __name__ == "__main__":
    맞은_수, 전체_수 = _시험()
    print(f"1순위 정답: {맞은_수}/{전체_수} ({맞은_수 / 전체_수:.1%})")
