const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8787;

app.use(cors());
app.use(express.json());

let courses = [
  { id: 'S7-1200-01', vendor: 'Siemens', module: 'M01', title: '西门子 S7-1200 入门与硬件组态', sub: 'TIA Portal · I/O 映射 · OB1 扫描', progress: 60, lessons: 12, level: 'Beginner', source: 'seed', url: 'https://www.bilibili.com' },
  { id: 'S7-1500-02', vendor: 'Siemens', module: 'M02', title: '西门子 S7-1500 数据块与寄存器', sub: 'DB · FC · FB · UDT', progress: 30, lessons: 9, level: 'Intermediate', source: 'seed', url: 'https://www.bilibili.com' },
  { id: 'FX5U-01', vendor: 'Mitsubishi', module: 'M03', title: '三菱 FX5U 梯形图与高速计数', sub: 'GX Works3 · X/Y/M/D', progress: 40, lessons: 10, level: 'Beginner', source: 'seed', url: 'https://www.bilibili.com' },
  { id: 'NJNX-01', vendor: 'Omron', module: 'M04', title: '欧姆龙 NJ/NX 结构化编程', sub: 'Task 周期 · ST/LD 混编', progress: 20, lessons: 8, level: 'Intermediate', source: 'seed', url: 'https://www.bilibili.com' },
  { id: 'ABB-VFD-01', vendor: 'ABB', module: 'M05', title: 'ABB 变频器 ACS 系列调试', sub: '参数映射 · 启停逻辑 · Modbus', progress: 15, lessons: 7, level: 'Intermediate', source: 'seed', url: 'https://www.bilibili.com' },
  { id: 'PLC-IO-ADV', vendor: 'Universal', module: 'M06', title: 'I/O 映射与故障诊断', sub: 'DI/DO/AI/AO · 互锁与闭锁', progress: 75, lessons: 6, level: 'Beginner', source: 'seed', url: 'https://www.bilibili.com' },
];

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'plc-learning-api', timestamp: Date.now(), count: courses.length });
});

app.get('/api/courses', (req, res) => {
  const { vendor, q } = req.query;
  const filtered = courses.filter((c) => {
    const byVendor = vendor ? c.vendor.toLowerCase() === String(vendor).toLowerCase() : true;
    const byText = q
      ? [c.title, c.sub, c.vendor, c.module].join(' ').toLowerCase().includes(String(q).toLowerCase())
      : true;
    return byVendor && byText;
  });
  res.json({ courses: filtered, total: filtered.length });
});

app.post('/api/courses/import', (req, res) => {
  const payload = Array.isArray(req.body?.courses) ? req.body.courses : [];
  const normalized = payload
    .filter((v) => v && v.id && v.title)
    .map((v) => ({ ...v, source: v.source || 'import' }));

  const map = new Map(courses.map((c) => [c.id, c]));
  normalized.forEach((c) => map.set(c.id, c));
  courses = Array.from(map.values());

  res.json({ ok: true, imported: normalized.length, total: courses.length });
});

app.listen(PORT, () => {
  console.log(`[plc-learning-api] running on http://localhost:${PORT}`);
});
