// monitor/tools/capture-fixtures.js — 本地跑一次,存真实页面供解析测试
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch, slowScroll } from '../lib/browser.js';

const targets = [
  ['search.html', 'https://www.tokopedia.com/search?st=product&q=sofa%20bed%20minimalis&ob=8', true],
  ['product.html', 'https://www.tokopedia.com/meexistore/meexi-sofabed-density-23-sofa-bed-minimalis-sofa-tidur-sofa-kasur-sofa-vacuum-compressible-boneless-couch-sofa-kecil-untuk-kamar-sofa-untuk-ruang-tamu-sempit-tapi-mewah-kasur-sofa-1732127420746466525', false],
  ['shop.html', 'https://www.tokopedia.com/meexistore', true],
];

mkdirSync(new URL('../fixtures/', import.meta.url), { recursive: true });
const b = await launch({ fast: true });
for (const [name, url, scroll] of targets) {
  const r = await b.visit(url);
  if (r !== 'ok') { console.error(name, r); continue; }
  if (scroll) await slowScroll(b.page);
  const html = await b.page.content();
  writeFileSync(new URL(`../fixtures/${name}`, import.meta.url), html);
  console.log('saved', name, html.length);
}
await b.close();
