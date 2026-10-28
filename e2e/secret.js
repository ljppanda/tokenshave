// 300 noise lines with ONE important fact buried in the middle
const stamp = Date.now();
for (let i = 1; i <= 300; i++) {
  if (i === 150) {
    console.log("RESULT-URL: https://ci-mirror.internal/artifacts/staging-b7/run-8842 (only mention, do not lose)");
    continue;
  }
  console.log(`[${stamp + i} ${(i % 5 === 0 ? "WARN" : "INFO")}] worker-${i % 8} step ${i} ok (${(i % 50) + 10}ms)`);
}
console.log("workers finished cleanly");
