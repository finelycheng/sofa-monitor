// monitor/scrape/reviews.js — 打开 PDP,点低星过滤,统计负面关键词
import { slowScroll } from '../lib/browser.js';

export async function scanReviews(page, negativeKeywords) {
  await slowScroll(page, 10);
  const texts = await page.evaluate(async () => {
    const collect = () => [...document.querySelectorAll('article')]
      .map((n) => n.innerText).filter((t) => t.length > 40 && t.length < 1200 && /lalu/.test(t));
    const clickStar = async (star) => {
      const btns = [...document.querySelectorAll('button, [role="button"], label')]
        .filter((e) => e.innerText?.trim() === star);
      if (!btns.length) return false;
      btns[0].click();
      await new Promise((r) => setTimeout(r, 1600));
      return true;
    };
    let all = [];
    for (const s of ['1', '2', '3']) {
      if (await clickStar(s)) { all = all.concat(collect()); await clickStar(s); }
    }
    return all;
  });
  const kw = {};
  for (const k of negativeKeywords) kw[k] = texts.filter((t) => t.toLowerCase().includes(k)).length;
  return { lowStarSampled: texts.length, kw };
}
