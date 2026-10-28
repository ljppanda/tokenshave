// noisier than any real build: 300 lines of build spam ending in an error
const stamp = Date.now();
for (let i = 1; i <= 300; i++) {
  const kind = i % 7 === 0
    ? `[${stamp + i} WARN] deprecation: option "${i}" is deprecated, retires in 2027`
    : `[${stamp + i} INFO] resolved pkg-${i}@1.${i}.0 from cache (avg ${(i % 40) + 60}ms)`;
  console.log(kind);
}
console.error("node:internal/stream:142 ERROR: EACCES permission denied, unlink './build/seg-99'");
process.exit(1);
