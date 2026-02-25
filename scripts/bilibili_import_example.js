/**
 * 示例：从 B 站搜索结果抓取“工控圈”相关课程并导入本地 API。
 * 说明：B 站接口可能有风控，建议在有 Cookie 的情况下运行。
 * 用法：
 *   BILI_COOKIE='SESSDATA=...' node scripts/bilibili_import_example.js
 */

const API_BASE = process.env.API_BASE || 'http://localhost:8787/api';
const KEYWORDS = ['西门子 PLC', '三菱 PLC', '欧姆龙 PLC', 'ABB 变频器', '工控圈'];

async function search(keyword) {
  const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(keyword)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Cookie: process.env.BILI_COOKIE || '',
    },
  });
  const data = await res.json();
  const arr = data?.data?.result || [];

  return arr.slice(0, 8).map((v, idx) => ({
    id: `BILI-${keyword}-${idx}-${v.aid}`,
    vendor: /西门子/i.test(v.title) ? 'Siemens'
      : /三菱/i.test(v.title) ? 'Mitsubishi'
      : /欧姆龙/i.test(v.title) ? 'Omron'
      : /ABB|变频器/i.test(v.title) ? 'ABB'
      : 'Universal',
    module: 'BILI',
    title: String(v.title || '').replace(/<[^>]+>/g, ''),
    sub: `${keyword} · B站视频`,
    progress: 0,
    lessons: 1,
    level: 'Mixed',
    source: 'bilibili',
    url: `https://www.bilibili.com/video/${v.bvid}`,
  }));
}

async function main() {
  const all = [];
  for (const k of KEYWORDS) {
    try {
      const items = await search(k);
      all.push(...items);
      console.log(`[ok] ${k} -> ${items.length}`);
    } catch (e) {
      console.log(`[skip] ${k}: ${e.message}`);
    }
  }

  const resp = await fetch(`${API_BASE}/courses/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courses: all }),
  });
  const result = await resp.json();
  console.log('import result:', result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
