import test from 'node:test';
import assert from 'node:assert/strict';
import { billingBounds,dayKey,validDate,usedTraffic } from '../server/store.mjs';

test('账单日 31 在二月与闰年钳制为月底，结束日不含',()=>{
  assert.deepEqual(billingBounds('2026-02-27',31),{start:'2026-01-31',end:'2026-02-28'});
  assert.deepEqual(billingBounds('2026-02-28',31),{start:'2026-02-28',end:'2026-03-31'});
  assert.deepEqual(billingBounds('2024-02-29',31),{start:'2024-02-29',end:'2024-03-31'});
  assert.deepEqual(billingBounds('2026-01-01',15),{start:'2025-12-15',end:'2026-01-15'});
});
test('统计时区跨日与日历日期校验',()=>{
  assert.equal(dayKey(new Date('2026-10-10T17:00:00Z'),'Asia/Shanghai'),'2026-10-11');
  assert.equal(dayKey(new Date('2026-10-10T17:00:00Z'),'UTC'),'2026-10-10');
  assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2024-02-29'),true);
});
test('计费方向不混淆物理网卡与套餐口径',()=>{
  assert.equal(usedTraffic(100,300,'sum'),400);assert.equal(usedTraffic(100,300,'tx'),300);
  assert.equal(usedTraffic(100,300,'rx'),100);assert.equal(usedTraffic(100,300,'max'),300);
});
