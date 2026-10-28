const { test } = require("node:test");
const assert = require("node:assert");
test("add works", () => { assert.equal(1 + 2, 3); });
test("mul works", () => { assert.equal(2 * 3, 6); });
test("div fails on purpose", () => { assert.equal(10 / 2, 6); });
for (let i = 0; i < 40; i++) { test(`generated case ${i}`, () => { assert.ok(i % 2 === 0); }); }
