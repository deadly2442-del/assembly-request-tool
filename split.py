"""원문 자료요구서 PDF를 문항 단위 CSV로 분해한다."""

from __future__ import annotations

import csv
import re
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent
SOURCE_DIR = ROOT / "원문"
OUTPUT_CSV = ROOT / "data" / "문항목록.csv"
CSV_COLUMNS = [
    "파일명",
    "위원회",
    "의원",
    "제출기한",
    "문항번호",
    "요구내용",
    "세부항목",
    "비고",
]

TITLE_RE = re.compile(
    r"^(?P<committee>.+?위원회)\s+(?P<legislator>.+?)\s+의원실\s+자료요구서\s*$"
)
DUE_RE = re.compile(
    r"제출기한\s*:\s*(?P<year>\d{4})\.\s*(?P<month>\d{1,2})\.\s*(?P<day>\d{1,2})\."
)
QUESTION_RE = re.compile(r"^(?P<number>\d+)\.\s*(?P<text>.*)$")
DETAIL_RE = re.compile(r"^(?P<label>[가-힣])\.\s*(?P<text>.*)$")
EXPECTED_COUNT_RE = re.compile(r"_(?P<count>\d+)문항\.pdf$")


def normalize_line(line: str) -> str:
    """PDF 추출 과정에서 생긴 불필요한 앞뒤 공백을 없앤다."""
    return line.strip()


def append_text(existing: str, addition: str, *, new_item: bool = False) -> str:
    """빈 줄 없이 내용을 잇고, 새 세부항목·비고는 슬래시로 나눈다."""
    addition = addition.strip()
    if not addition:
        return existing
    if not existing:
        return addition
    separator = " / " if new_item else " "
    return f"{existing}{separator}{addition}"


def extract_lines(pdf_path: Path) -> list[str]:
    reader = PdfReader(pdf_path)
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    return [normalize_line(line) for line in text.splitlines() if line.strip()]


def parse_pdf(pdf_path: Path) -> tuple[list[dict[str, str]], list[str]]:
    lines = extract_lines(pdf_path)
    if not lines:
        raise ValueError(f"텍스트를 추출하지 못했습니다: {pdf_path.name}")

    title_match = TITLE_RE.match(lines[0])
    if not title_match:
        raise ValueError(f"첫 줄 형식을 확인할 수 없습니다: {pdf_path.name}")

    due_match = next((DUE_RE.search(line) for line in lines if line.startswith("수신:")), None)
    if not due_match:
        raise ValueError(f"제출기한을 확인할 수 없습니다: {pdf_path.name}")
    due_date = (
        f"{int(due_match['year']):04d}-"
        f"{int(due_match['month']):02d}-"
        f"{int(due_match['day']):02d}"
    )

    common = {
        "파일명": pdf_path.name,
        "위원회": title_match["committee"],
        "의원": title_match["legislator"],
        "제출기한": due_date,
    }
    rows: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    current_field = "요구내용"

    for line in lines[1:]:
        if line.startswith(("수신:", "담당 보좌관:")) or line == "끝.":
            continue

        question_match = QUESTION_RE.match(line)
        if question_match:
            if current is not None:
                rows.append(current)
            current = {
                **common,
                "문항번호": question_match["number"],
                "요구내용": question_match["text"].strip(),
                "세부항목": "",
                "비고": "",
            }
            current_field = "요구내용"
            continue

        if current is None:
            continue

        detail_match = DETAIL_RE.match(line)
        if detail_match:
            detail = f"{detail_match['label']}. {detail_match['text'].strip()}".rstrip()
            current["세부항목"] = append_text(
                current["세부항목"], detail, new_item=True
            )
            current_field = "세부항목"
        elif line.startswith("※"):
            note = line.removeprefix("※").strip()
            current["비고"] = append_text(current["비고"], note, new_item=True)
            current_field = "비고"
        else:
            current[current_field] = append_text(current[current_field], line)

    if current is not None:
        rows.append(current)
    return rows, lines


def expected_count(pdf_path: Path) -> int | None:
    match = EXPECTED_COUNT_RE.search(pdf_path.name)
    return int(match["count"]) if match else None


def is_consecutive(rows: list[dict[str, str]]) -> bool:
    numbers = [int(row["문항번호"]) for row in rows]
    return numbers == list(range(1, len(numbers) + 1))


def print_verification(results: list[tuple[Path, list[dict[str, str]], list[str]]]) -> None:
    print("파일명 | 파일명의 문항 수 | 뽑은 문항 수 | 마지막 번호 | 번호 연속 | 일치(O/X)")
    for pdf_path, rows, _ in results:
        expected = expected_count(pdf_path)
        extracted = len(rows)
        last_number = rows[-1]["문항번호"] if rows else "-"
        consecutive = is_consecutive(rows)
        matched = expected == extracted and last_number == str(expected) and consecutive
        print(
            f"{pdf_path.name} | {expected if expected is not None else '-'} | "
            f"{extracted} | {last_number} | {'O' if consecutive else 'X'} | "
            f"{'O' if matched else 'X'}"
        )


def print_samples(results: list[tuple[Path, list[dict[str, str]], list[str]]]) -> None:
    print("\n[원문 대조: 세부항목·비고가 모두 있는 문항 3개]")
    samples: list[tuple[Path, dict[str, str]]] = []
    for pdf_path, rows, _ in results:
        sample = next((row for row in rows if row["세부항목"] and row["비고"]), None)
        if sample:
            samples.append((pdf_path, sample))
    for pdf_path, row in samples[:3]:
        source_lines = next(lines for path, _, lines in results if path == pdf_path)
        start = next(
            index
            for index, line in enumerate(source_lines)
            if QUESTION_RE.match(line)
            and QUESTION_RE.match(line)["number"] == row["문항번호"]
        )
        following = source_lines[start + 1 :]
        end_offset = next(
            (index for index, line in enumerate(following) if QUESTION_RE.match(line)),
            len(following),
        )
        original = " / ".join(source_lines[start : start + 1 + end_offset])
        print(f"- {pdf_path.name} {row['문항번호']}번")
        print(f"  원문 PDF: {original}")
        print(
            "  CSV: "
            f"요구내용={row['요구내용']} | "
            f"세부항목={row['세부항목'].replace(chr(10), ' / ')} | "
            f"비고={row['비고'].replace(chr(10), ' / ')}"
        )


def main() -> None:
    pdf_paths = sorted(SOURCE_DIR.glob("*.pdf"))
    if len(pdf_paths) != 3:
        raise ValueError(f"원문 PDF가 3건이어야 합니다. 현재 {len(pdf_paths)}건입니다.")

    results = [(path, *parse_pdf(path)) for path in pdf_paths]
    all_rows = [row for _, rows, _ in results for row in rows]

    with OUTPUT_CSV.open("w", encoding="utf-8-sig", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"생성: {OUTPUT_CSV}")
    print(f"전체 문항 수: {len(all_rows)}")
    print_verification(results)
    print_samples(results)


if __name__ == "__main__":
    main()
