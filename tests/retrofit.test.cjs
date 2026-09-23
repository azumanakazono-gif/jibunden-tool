const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate,defaults}=require('../retrofit.js');
const sample={...defaults,generation:6000,exportKwh:4000,importKwh:4800,bill:160000,buyRate:30,sellRate:8,capacity:10,reserve:0,efficiency:90,matching:100,nightShare:100,days:365,cost:100,years:15,degradation:0};
test('売電機会損失と往復損失を控除、既存の直接自家消費は加算しない',()=>{
 const r=calculate(sample);assert.deepEqual(r.errors,[]);
 assert.equal(r.first.charge,3650);assert.equal(r.first.discharge,3285);
 assert.equal(r.first.saving,98550);assert.equal(r.first.lostSales,29200);
 assert.equal(r.first.net,69350);assert.equal(r.cumulative,40250);
 assert.equal(r.direct,2000);assert.equal(r.first.importAfter,1515);assert.equal(r.first.exportAfter,350);
 assert.equal(r.payback,1000000/69350);
});
test('FIT終了前後で売電機会損失を変更する',()=>{
 const r=calculate({...sample,fitYears:2,fitRate:48});
 assert.equal(r.rows[1].sellRate,48);assert.equal(r.rows[2].sellRate,8);
 assert(r.first.net<0);assert(r.rows[2].net>0);
});
test('余剰なし・需要なし・停電用100%では節約を作らない',()=>{
 for(const change of [{exportKwh:0},{importKwh:0},{reserve:100},{days:0}]){
  const r=calculate({...sample,...change});assert.equal(r.first.discharge,0);assert.equal(r.payback,null);
 }
});
test('売電単価ゼロを保持し、充電・放電・料金上限を守る',()=>{
 const r=calculate({...sample,sellRate:0,importKwh:500,bill:10000});
 assert.equal(r.first.lostSales,0);assert.equal(r.first.saving,10000);
 assert(r.first.discharge<=500);assert(r.first.charge<=sample.exportKwh);assert(r.first.billAfter>=0);
});
test('入力未完了・矛盾・非数を拒否し、旧データは完成値に見せない',()=>{
 for(const change of [{generation:''},{exportKwh:7000},{efficiency:0},{cost:-1},{subsidy:101},{years:1.5},{replacementYear:20,replacementCost:10},{capacity:Infinity}])assert(calculate({...sample,...change}).errors.length);
 assert(calculate({}).errors.length);
});
test('容量低下・交換費・維持費・補助金を反映する',()=>{
 const r=calculate({...sample,degradation:2,subsidy:20,maintenance:3000,replacementYear:5,replacementCost:10});
 assert.equal(r.initial,800000);assert(r.rows[1].discharge<r.first.discharge);
 assert(Math.abs(r.rows[4].net-(r.rows[4].saving-r.rows[4].lostSales-103000))<1e-8);
});
test('100パターンで電力量・現金収支が整合する',()=>{
 for(let i=0;i<100;i++){
  const d={...sample,capacity:1+i/5,efficiency:50+i/2,reserve:i,matching:i,nightShare:100-i};
  const r=calculate(d),f=r.first;
  assert(f.charge<=d.exportKwh+1e-6);assert(f.discharge<=d.importKwh+1e-6);
  assert(Math.abs(f.charge-f.discharge-f.loss)<1e-8);
  assert(Math.abs((d.bill-f.salesBefore)-(f.billAfter-f.salesAfter)-f.net)<1e-7);
 }
});
