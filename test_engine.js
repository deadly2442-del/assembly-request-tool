const fs = require("node:fs");
const path = require("node:path");

const engine = require("./web/engine.js");

async function main() {
  await engine.init();

  const testPath = path.join(__dirname, "data", "시험_요구문항_40건.csv");
  const tests = engine.parseCsv(fs.readFileSync(testPath, "utf8"));
  let firstCorrect = 0;
  let topThreeCorrect = 0;
  const incorrect = [];

  for (const test of tests) {
    const result = engine.classify(test.요구내용);
    const departments = result.map((candidate) => candidate.과);
    const isFirstCorrect = departments[0] === test.정답_배분과;

    if (isFirstCorrect) {
      firstCorrect += 1;
    } else {
      incorrect.push({
        시험번호: test.시험번호,
        요구내용: test.요구내용,
        정답: test.정답_배분과,
        "엔진 결과":
          result
            .map(
              (candidate) =>
                `${candidate.과}(${candidate.점수}; ${candidate.근거키워드})`,
            )
            .join(" / ") || "후보 없음",
      });
    }
    if (departments.includes(test.정답_배분과)) {
      topThreeCorrect += 1;
    }
  }

  console.log(
    `1순위 정답 ${firstCorrect}/${tests.length} · 3순위 안 ${topThreeCorrect}/${tests.length}`,
  );
  console.log("\n틀린 문항 표");
  console.table(incorrect);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
