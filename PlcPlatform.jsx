import { useState, useEffect, useRef, useCallback } from "react";

// ─── Color tokens & fonts injected via style tag ───────────────────────────
const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow+Condensed:wght@300;400;600;700;900&family=Orbitron:wght@400;700;900&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg-void:      #080c0f;
      --bg-panel:     #0d1419;
      --bg-raised:    #111b22;
      --bg-hover:     #162028;
      --amber:        #f5a623;
      --amber-dim:    #a06a12;
      --amber-glow:   rgba(245,166,35,0.18);
      --green:        #39ff8a;
      --green-dim:    #1a7a42;
      --green-glow:   rgba(57,255,138,0.15);
      --red:          #ff3b5c;
      --red-glow:     rgba(255,59,92,0.2);
      --cyan:         #00d4ff;
      --cyan-glow:    rgba(0,212,255,0.15);
      --grid:         rgba(245,166,35,0.04);
      --border:       rgba(245,166,35,0.2);
      --border-bright:rgba(245,166,35,0.5);
      --text-primary: #e8d5a3;
      --text-dim:     #6b5a38;
      --text-muted:   #3d2e18;
      --font-mono:    'Share Tech Mono', monospace;
      --font-ui:      'Barlow Condensed', sans-serif;
      --font-display: 'Orbitron', sans-serif;
    }

    html, body, #root { height: 100%; background: var(--bg-void); }

    body {
      font-family: var(--font-mono);
      color: var(--text-primary);
      overflow: hidden;
    }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 4px; height: 4px; }
    ::-webkit-scrollbar-track { background: var(--bg-void); }
    ::-webkit-scrollbar-thumb { background: var(--amber-dim); border-radius: 2px; }

    /* CRT scanline overlay */
    .plc-root::before {
      content: '';
      position: fixed; inset: 0; z-index: 9999;
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(0,0,0,0.03) 2px,
        rgba(0,0,0,0.03) 4px
      );
      pointer-events: none;
    }

    /* Grid background */
    .plc-root {
      background-image:
        linear-gradient(var(--grid) 1px, transparent 1px),
        linear-gradient(90deg, var(--grid) 1px, transparent 1px);
      background-size: 24px 24px;
    }

    .glow-amber { text-shadow: 0 0 8px var(--amber), 0 0 20px var(--amber-dim); }
    .glow-green { text-shadow: 0 0 8px var(--green), 0 0 16px var(--green-dim); }
    .glow-red   { text-shadow: 0 0 8px var(--red); }

    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
    @keyframes scanIn { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
    @keyframes pulse-border {
      0%,100% { border-color: rgba(245,166,35,0.2); box-shadow: none; }
      50%      { border-color: rgba(245,166,35,0.7); box-shadow: 0 0 12px var(--amber-glow); }
    }
    @keyframes spin-slow { to { transform: rotate(360deg); } }
    @keyframes data-flow {
      0%   { stroke-dashoffset: 100; }
      100% { stroke-dashoffset: 0; }
    }
    @keyframes contact-close {
      0%   { d: path("M 0 8 L 12 8"); }
      100% { d: path("M 0 8 L 12 8"); }
    }
    @keyframes rung-flash {
      0%,100% { background: transparent; }
      50%      { background: rgba(57,255,138,0.08); }
    }
  `}</style>
);

// ─── Tiny helpers ──────────────────────────────────────────────────────────
const hex2 = (n) => n.toString(16).padStart(2, "0").toUpperCase();
const toBin8 = (n) => (n & 0xff).toString(2).padStart(8, "0");
const useInterval = (fn, ms) => {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; }, [fn]);
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
};

const API_BASE = typeof window !== "undefined" && window.__PLC_API_BASE__
  ? window.__PLC_API_BASE__
  : "http://localhost:8787/api";

const fetchJSON = async (path) => {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`);
  return res.json();
};

// ─── PLC 扫描引擎（纯函数）─────────────────────────────────────────────────
// 源自 Gemini 架构建议：将逻辑从 React 副作用中剥离为可独立测试的纯函数
// 每次调用等价于 PLC 的一个完整扫描周期（读输入 → 执行程序 → 写输出）
const runPLCScan = (state) => {
  const next = { ...state };

  const emergency = !!next["I1.0"];
  const overload = !!next["I0.2"];
  const stopPressed = !!next["I0.1"];
  const resetPressed = !!next["I0.3"];

  // 网络 1: 起保停自锁 — Q0.0 = (I0.0 OR Q0.0) AND NOT I0.1
  // I0.0 启动按钮(NO) | I0.1 停止按钮(NC，物理按下=true→断开回路)
  // 允许 I0.3 做故障复位：当复位按钮按下且故障信号消失后可再次启动
  const faultActive = emergency || overload;
  next["M0.0"] = faultActive && !resetPressed;

  next["Q0.0"] = (next["I0.0"] || next["Q0.0"]) && !stopPressed && !next["M0.0"];

  // 网络 2: 热继电器过载报警 — Q0.1 = I0.2
  // I0.2 接热继常开触点：正常=OFF，过载跳闸=ON → 驱动报警灯
  next["Q0.1"] = next["M0.0"];

  // 网络 3: 运行状态同步 — Q0.2 = Q0.0
  // 运行指示灯直接跟随接触器状态（简化，完整版需等待定时器 T1.DN）
  next["Q0.2"] = next["Q0.0"] && !next["Q0.1"];

  // 网络 4: 心跳指示灯（CPU RUN 时闪烁）
  next["Q0.3"] = !next["Q0.3"];

  return next;
};

// ─── Top Bar ───────────────────────────────────────────────────────────────
const TopBar = ({ scanCount, scanTime, running, onToggle, scanInterval, onIntervalChange, onReset, backendOnline }) => {
const TopBar = ({ scanCount, scanTime, running, onToggle, scanInterval, onIntervalChange, onReset }) => {
  const [time, setTime] = useState(new Date());
  useInterval(() => setTime(new Date()), 1000);

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 24px", height: 52,
      background: "linear-gradient(180deg, #0a1218 0%, var(--bg-panel) 100%)",
      borderBottom: "1px solid var(--border)",
      boxShadow: "0 1px 0 rgba(245,166,35,0.05)",
      flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <rect x="1" y="1" width="26" height="26" rx="3" stroke="#f5a623" strokeWidth="1.5" fill="none"/>
          <rect x="5" y="5" width="6" height="6" rx="1" fill="#f5a623" opacity="0.9"/>
          <rect x="17" y="5" width="6" height="6" rx="1" fill="#39ff8a" opacity="0.9"/>
          <rect x="5" y="17" width="6" height="6" rx="1" fill="#39ff8a" opacity="0.7"/>
          <rect x="17" y="17" width="6" height="6" rx="1" fill="#f5a623" opacity="0.5"/>
          <line x1="11" y1="8" x2="17" y2="8" stroke="#f5a623" strokeWidth="1" opacity="0.6"/>
          <line x1="8" y1="11" x2="8" y2="17" stroke="#39ff8a" strokeWidth="1" opacity="0.6"/>
          <line x1="20" y1="11" x2="20" y2="17" stroke="#f5a623" strokeWidth="1" opacity="0.4"/>
          <line x1="11" y1="20" x2="17" y2="20" stroke="#39ff8a" strokeWidth="1" opacity="0.5"/>
        </svg>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: "var(--amber)", letterSpacing: 2 }}>
            PLC<span style={{ color: "var(--green)" }}>ACADEMY</span>
          </div>
          <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 3, marginTop: -2 }}>INDUSTRIAL CONTROL SYSTEMS</div>
        </div>
      </div>

      {/* Status row */}
      <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
        <StatusBadge label="扫描周期" value={`${scanTime.toFixed(1)} ms`} color="var(--cyan)" />
        <StatusBadge label="扫描计数" value={scanCount.toLocaleString()} color="var(--amber)" />
        <StatusBadge label="CPU 状态" value={running ? "RUN" : "STOP"} color={running ? "var(--green)" : "var(--red)"} blink={!running} />
        <StatusBadge label="后端" value={backendOnline ? "API ONLINE" : "API OFFLINE"} color={backendOnline ? "var(--green)" : "var(--red)"} blink={!backendOnline} />

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {[50, 100, 200].map((ms) => (
            <button key={ms} onClick={() => onIntervalChange(ms)} style={{
              fontFamily: "var(--font-display)", fontSize: 10, padding: "4px 8px",
              border: "1px solid var(--border)",
              color: scanInterval === ms ? "var(--amber)" : "var(--text-dim)",
              background: scanInterval === ms ? "var(--amber-glow)" : "transparent",
              cursor: "pointer",
            }}>{ms}ms</button>
          ))}
          <button onClick={onReset} style={{
            fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 700,
            padding: "6px 12px", border: "1px solid var(--border)", color: "var(--amber)",
            background: "var(--bg-raised)", cursor: "pointer", letterSpacing: 1,
          }}>RESET</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {[50, 100, 200].map((ms) => (
            <button key={ms} onClick={() => onIntervalChange(ms)} style={{
              fontFamily: "var(--font-display)", fontSize: 10, padding: "4px 8px",
              border: "1px solid var(--border)",
              color: scanInterval === ms ? "var(--amber)" : "var(--text-dim)",
              background: scanInterval === ms ? "var(--amber-glow)" : "transparent",
              cursor: "pointer",
            }}>{ms}ms</button>
          ))}
          <button onClick={onReset} style={{
            fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 700,
            padding: "6px 12px", border: "1px solid var(--border)", color: "var(--amber)",
            background: "var(--bg-raised)", cursor: "pointer", letterSpacing: 1,
          }}>RESET</button>
        </div>

        <button onClick={onToggle} style={{
          fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 700,
          padding: "6px 20px", border: "1px solid",
          borderColor: running ? "var(--red)" : "var(--green)",
          color: running ? "var(--red)" : "var(--green)",
          background: running ? "var(--red-glow)" : "var(--green-glow)",
          cursor: "pointer", letterSpacing: 2,
          transition: "all 0.2s",
        }}>{running ? "■ STOP" : "▶ RUN"}</button>
      </div>

      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-dim)", textAlign: "right" }}>
        <div>{time.toLocaleDateString("zh-CN")}</div>
        <div style={{ color: "var(--amber)", fontSize: 14 }}>{time.toLocaleTimeString("zh-CN")}</div>
      </div>
    </div>
  );
};

const StatusBadge = ({ label, value, color, blink }) => (
  <div style={{ textAlign: "center" }}>
    <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 2, textTransform: "uppercase" }}>{label}</div>
    <div style={{
      fontFamily: "var(--font-display)", fontSize: 13, color,
      animation: blink ? "blink 1s infinite" : "none",
    }}>{value}</div>
  </div>
);

// ─── Sidebar Nav ───────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: "ladder", icon: "⊞", label: "梯形图", sub: "Ladder Logic" },
  { id: "io",     icon: "⊡", label: "I/O 映射", sub: "I/O Mapping" },
  { id: "memory", icon: "▦", label: "寄存器", sub: "Registers" },
  { id: "course", icon: "◈", label: "课程模块", sub: "Curriculum" },
  { id: "timing", icon: "◎", label: "时序图", sub: "Timing Diagram" },
  { id: "diag",   icon: "⌬", label: "诊断日志", sub: "Diagnostics" },
];

const Sidebar = ({ active, onChange }) => (
  <div style={{
    width: 88, flexShrink: 0,
    background: "var(--bg-panel)",
    borderRight: "1px solid var(--border)",
    display: "flex", flexDirection: "column",
    paddingTop: 16, gap: 4,
  }}>
    {NAV_ITEMS.map(item => (
      <button key={item.id} onClick={() => onChange(item.id)} style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "12px 4px", border: "none", cursor: "pointer",
        background: active === item.id ? "var(--amber-glow)" : "transparent",
        borderLeft: `2px solid ${active === item.id ? "var(--amber)" : "transparent"}`,
        transition: "all 0.15s",
      }}>
        <span style={{
          fontSize: 20, lineHeight: 1,
          color: active === item.id ? "var(--amber)" : "var(--text-dim)",
          filter: active === item.id ? "drop-shadow(0 0 6px var(--amber))" : "none",
        }}>{item.icon}</span>
        <span style={{
          fontSize: 9, marginTop: 4, letterSpacing: 1, textTransform: "uppercase",
          color: active === item.id ? "var(--amber)" : "var(--text-dim)",
          fontFamily: "var(--font-ui)",
        }}>{item.label}</span>
      </button>
    ))}
    <div style={{ flex: 1 }} />
    <div style={{ padding: 12, fontSize: 9, color: "var(--text-muted)", textAlign: "center", letterSpacing: 1 }}>
      IEC<br/>61131-3<br/>v2.4
    </div>
  </div>
);

// ─── Panel wrapper ─────────────────────────────────────────────────────────
const Panel = ({ title, subtitle, children, actions, style = {} }) => (
  <div style={{
    display: "flex", flexDirection: "column",
    background: "var(--bg-panel)", border: "1px solid var(--border)",
    overflow: "hidden", ...style,
  }}>
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "8px 16px",
      background: "linear-gradient(90deg, rgba(245,166,35,0.06) 0%, transparent 100%)",
      borderBottom: "1px solid var(--border)",
      flexShrink: 0,
    }}>
      <div>
        <div style={{ fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 13, letterSpacing: 2, color: "var(--amber)", textTransform: "uppercase" }}>{title}</div>
        {subtitle && <div style={{ fontSize: 10, color: "var(--text-dim)", letterSpacing: 1 }}>{subtitle}</div>}
      </div>
      {actions && <div style={{ display: "flex", gap: 8 }}>{actions}</div>}
    </div>
    <div style={{ flex: 1, overflow: "auto" }}>{children}</div>
  </div>
);

// ─── 梯形图网络定义 ────────────────────────────────────────────────────────
// parallel 字段：该组触点互相并联（任一导通即可），再与 series 串联
// series  字段：与并联组串联的独立触点（必须全部导通）
const RUNGS = [
  {
    id: "N:001",
    comment: "电机起保停控制 — Seal-in (Start/Stop) Circuit",
    // I0.0(启动) 与 Q0.0(自保) 并联后，再串联 I0.1(停止 NC)
    parallel: [
      { addr: "I0.0", label: "启动",  type: "NO" },
      { addr: "Q0.0", label: "自保",  type: "NO" }, // 自锁触点：Q0.0 得电后维持回路
    ],
    series: [
      { addr: "I0.1", label: "停止", type: "NC" }, // NC：未按下导通，按下断开
    ],
    coil: { addr: "Q0.0", label: "接触器 K1", type: "COIL" },
  },
  {
    id: "N:002",
    comment: "过载故障报警 — Thermal Overload Alarm (Q0.1 = I0.2)",
    parallel: [],
    series: [
      { addr: "I0.2", label: "热继 FR1", type: "NO" }, // NO：正常=OFF，过载跳闸=ON
    ],
    coil: { addr: "Q0.1", label: "报警灯 H1", type: "COIL" },
  },
  {
    id: "N:003",
    comment: "运行状态同步 — Run Indicator (Q0.2 = Q0.0)",
    parallel: [],
    series: [
      { addr: "Q0.0", label: "K1 辅助", type: "NO" }, // 接触器辅助触点
    ],
    coil: { addr: "Q0.2", label: "指示灯 H2", type: "COIL" },
  },
];

// ─── Ladder Logic View ─────────────────────────────────────────────────────
const LadderView = ({ ioState, running }) => {
  const [activeRung, setActiveRung] = useState(null);

  // 解析单个触点的通断状态（NO/NC 逻辑）
  const resolveContact = (c) =>
    c.type === "NC" ? !ioState[c.addr] : !!ioState[c.addr];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 4 }}>
      {RUNGS.map((rung, ri) => {
        // 并联组导通：任一触点导通即可（OR）
        const parallelON = rung.parallel.length === 0
          ? true
          : rung.parallel.some(c => resolveContact(c));
        // 串联组导通：所有触点必须导通（AND）
        const seriesON = rung.series.every(c => resolveContact(c));
        // 梯级最终导通状态
        const energized = running && parallelON && seriesON;

        return (
          <div key={rung.id} onClick={() => setActiveRung(activeRung === ri ? null : ri)}
            style={{
              display: "flex", alignItems: "stretch", cursor: "pointer",
              background: activeRung === ri ? "rgba(245,166,35,0.05)" : "transparent",
              animation: energized ? "rung-flash 0.6s infinite" : "none",
              borderRadius: 4, minHeight: rung.parallel.length > 0 ? 110 : 72,
            }}>
            {/* ── 左母线 ── */}
            <RailV energized={energized} side="left" />

            <div style={{ flex: 1, padding: "8px 0 8px 0" }}>
              {/* 网络注释 */}
              <div style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: 8, marginBottom: 8, letterSpacing: 1 }}>
                {rung.id} · {rung.comment}
              </div>

              {/* 接线行：并联块 + 串联触点 + 线圈 */}
              <div style={{ display: "flex", alignItems: "center" }}>
                <RailH energized={energized} width={12} />

                {/* 并联块（自保支路）*/}
                {rung.parallel.length > 0 && (
                  <ParallelBlock contacts={rung.parallel} ioState={ioState}
                    running={running} energized={energized} resolveContact={resolveContact} />
                )}

                {/* 串联触点 */}
                {rung.series.map((c, ci) => (
                  <LadderContact key={ci}
                    contact={{ ...c, active: resolveContact(c) }}
                    energized={energized} running={running} />
                ))}

                <RailH energized={energized} flex />
                <LadderCoil coil={rung.coil} energized={energized} />
                <RailH energized={energized} width={12} />
              </div>
            </div>

            {/* ── 右母线 ── */}
            <RailV energized={energized} side="right" />
          </div>
        );
      })}

      {/* 图例 */}
      <div style={{ marginTop: 20, padding: 16, borderTop: "1px solid var(--border)", display: "flex", gap: 32, flexWrap: "wrap" }}>
        {[
          { sym: "—| |—", desc: "常开触点 NO" },
          { sym: "—|/|—", desc: "常闭触点 NC" },
          { sym: "—( )—", desc: "输出线圈" },
          { sym: "⌐ ¬",   desc: "并联分支" },
        ].map(l => (
          <div key={l.sym} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ fontFamily: "var(--font-mono)", color: "var(--amber)", fontSize: 13 }}>{l.sym}</code>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{l.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── 辅助：母线（竖向）
const RailV = ({ energized, side }) => (
  <div style={{
    width: 8, alignSelf: "stretch",
    background: energized ? "var(--green)" : "var(--bg-raised)",
    [side === "left" ? "borderRight" : "borderLeft"]: `3px solid ${energized ? "var(--green)" : "var(--border)"}`,
    boxShadow: energized ? "0 0 8px var(--green-glow)" : "none",
    transition: "all 0.2s", flexShrink: 0,
  }} />
);

// ── 辅助：水平连接线
const RailH = ({ energized, width, flex }) => (
  <div style={{
    height: 2,
    width: flex ? undefined : width,
    flex: flex ? 1 : undefined,
    background: energized ? "var(--green)" : "var(--amber-dim)",
    transition: "background 0.2s", flexShrink: 0,
  }} />
);

// ── 并联块：上支路(I0.0) + 下支路(Q0.0) + 两侧竖线连接
// 对应 Gemini 建议的自锁分支可视化
const ParallelBlock = ({ contacts, ioState, running, energized, resolveContact }) => {
  const railColor = energized ? "var(--green)" : "var(--amber-dim)";
  return (
    <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
      {/* 左侧竖连线 */}
      <svg width="12" height="64" style={{ flexShrink: 0 }}>
        <line x1="6" y1="0" x2="6" y2="64" stroke={railColor} strokeWidth="2"/>
        <line x1="6" y1="16" x2="12" y2="16" stroke={railColor} strokeWidth="2"/>
        <line x1="6" y1="48" x2="12" y2="48" stroke={railColor} strokeWidth="2"/>
      </svg>
      {/* 两条并联支路 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {contacts.map((c, i) => {
          const active = resolveContact(c);
          const branchOn = running && active;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center" }}>
              <LadderContact
                contact={{ ...c, active }}
                energized={branchOn} running={running} />
            </div>
          );
        })}
      </div>
      {/* 右侧竖连线 */}
      <svg width="12" height="64" style={{ flexShrink: 0 }}>
        <line x1="6" y1="0" x2="6" y2="64" stroke={railColor} strokeWidth="2"/>
        <line x1="0" y1="16" x2="6" y2="16" stroke={railColor} strokeWidth="2"/>
        <line x1="0" y1="48" x2="6" y2="48" stroke={railColor} strokeWidth="2"/>
      </svg>
    </div>
  );
};

const LadderContact = ({ contact, energized, running }) => {
  // contact.active 已由调用方通过 resolveContact() 计算好
  const on = running && contact.active;
  const isNC = contact.type === "NC";
  const color = on ? "var(--green)" : "var(--amber-dim)";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 70 }}>
      <div style={{ fontSize: 9, color: on ? "var(--green)" : "var(--text-dim)", letterSpacing: 1, marginBottom: 2 }}>{contact.addr}</div>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ height: 2, width: 8, background: color, transition: "background 0.2s" }} />
        <svg width="28" height="20" viewBox="0 0 28 20">
          {/* Contact symbol */}
          <line x1="0" y1="10" x2="8" y2="10" stroke={color} strokeWidth="2"/>
          <line x1="8" y1="4" x2="8" y2="16" stroke={color} strokeWidth="2"/>
          {isNC && <line x1="6" y1="4" x2="22" y2="16" stroke={color} strokeWidth="1.5"/>}
          <line x1="20" y1="4" x2="20" y2="16" stroke={color} strokeWidth="2"/>
          <line x1="20" y1="10" x2="28" y2="10" stroke={color} strokeWidth="2"/>
          {on && <circle cx="14" cy="10" r="3" fill="var(--green)" opacity="0.6"/>}
        </svg>
        <div style={{ height: 2, width: 8, background: color, transition: "background 0.2s" }} />
      </div>
      <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 0.5 }}>{contact.label}</div>
    </div>
  );
};

const LadderCoil = ({ coil, energized }) => {
  const color = energized ? "var(--green)" : "var(--amber-dim)";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 70 }}>
      <div style={{ fontSize: 9, color: energized ? "var(--green)" : "var(--text-dim)", letterSpacing: 1, marginBottom: 2 }}>{coil.addr}</div>
      <svg width="40" height="20" viewBox="0 0 40 20">
        <line x1="0" y1="10" x2="8" y2="10" stroke={color} strokeWidth="2"/>
        <ellipse cx="20" cy="10" rx="12" ry="8" fill="none" stroke={color} strokeWidth="2"/>
        {energized && <ellipse cx="20" cy="10" rx="8" ry="5" fill="var(--green)" opacity="0.25"/>}
        <line x1="32" y1="10" x2="40" y2="10" stroke={color} strokeWidth="2"/>
      </svg>
      <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 0.5, textAlign: "center" }}>{coil.label}</div>
    </div>
  );
};

// ─── I/O Mapping Table ─────────────────────────────────────────────────────
const IO_DEFS = [
  { addr: "I0.0", tag: "PB_START",  desc: "启动按钮",   type: "DI", wiring: "24VDC", module: "SM321" },
  { addr: "I0.1", tag: "PB_STOP",   desc: "停止按钮",   type: "DI", wiring: "24VDC", module: "SM321" },
  { addr: "I0.2", tag: "FR1",       desc: "热继电器",   type: "DI", wiring: "24VDC", module: "SM321" },
  { addr: "I0.3", tag: "PROX_1",    desc: "接近开关",   type: "DI", wiring: "NPN",   module: "SM321" },
  { addr: "I1.0", tag: "EMER",      desc: "急停按钮",   type: "DI", wiring: "24VDC", module: "SM321" },
  { addr: "Q0.0", tag: "KM1",       desc: "接触器 K1",  type: "DO", wiring: "Relay", module: "SM322" },
  { addr: "Q0.1", tag: "ALARM_H1",  desc: "报警灯",     type: "DO", wiring: "24VDC", module: "SM322" },
  { addr: "Q0.2", tag: "IND_H2",    desc: "运行指示",   type: "DO", wiring: "24VDC", module: "SM322" },
  { addr: "Q0.3", tag: "CPU_HB",    desc: "CPU 心跳灯", type: "DO", wiring: "24VDC", module: "SM322" },
  { addr: "AIW0", tag: "TEMP_PT100",desc: "温度传感器",  type: "AI", wiring: "4-20mA",module: "SM331" },
  { addr: "AIW2", tag: "PRESS",     desc: "压力变送器",  type: "AI", wiring: "4-20mA",module: "SM331" },
  { addr: "AQW0", tag: "VFD_REF",   desc: "变频器给定",  type: "AO", wiring: "0-10V", module: "SM332" },
];

const IOView = ({ ioState, onToggle }) => (
  <div style={{ padding: 16 }}>
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: "2px solid var(--amber-dim)" }}>
          {["地址", "TAG 名称", "描述", "类型", "接线", "模块", "当前状态"].map(h => (
            <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 11, letterSpacing: 2, color: "var(--amber)", textTransform: "uppercase" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {IO_DEFS.map((io, i) => {
          const val = ioState[io.addr];
          const isDig = io.type === "DI" || io.type === "DO";
          const canToggle = io.type === "DI";
          return (
            <tr key={io.addr} style={{
              borderBottom: "1px solid var(--border)",
              background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
              animation: "scanIn 0.3s ease forwards",
              animationDelay: `${i * 0.03}s`,
            }}>
              <td style={{ padding: "8px 12px" }}>
                <code style={{ color: "var(--cyan)", fontSize: 13 }}>{io.addr}</code>
              </td>
              <td style={{ padding: "8px 12px" }}>
                <code style={{ color: "var(--amber)", fontSize: 11 }}>{io.tag}</code>
              </td>
              <td style={{ padding: "8px 12px", color: "var(--text-primary)", fontSize: 11 }}>{io.desc}</td>
              <td style={{ padding: "8px 12px" }}>
                <span style={{
                  padding: "2px 8px", fontSize: 10, fontFamily: "var(--font-ui)", fontWeight: 700, letterSpacing: 1,
                  background: { DI:"rgba(0,212,255,0.12)", DO:"rgba(245,166,35,0.12)", AI:"rgba(57,255,138,0.1)", AO:"rgba(255,59,92,0.1)" }[io.type],
                  color: { DI:"var(--cyan)", DO:"var(--amber)", AI:"var(--green)", AO:"var(--red)" }[io.type],
                  borderRadius: 2,
                }}>{io.type}</span>
              </td>
              <td style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>{io.wiring}</td>
              <td style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>{io.module}</td>
              <td style={{ padding: "8px 12px" }}>
                {isDig ? (
                  <button onClick={() => onToggle(io.addr)} style={{
                    cursor: "pointer", border: "1px solid",
                    borderColor: val ? "var(--green)" : "var(--border)",
                    background: val ? "var(--green-glow)" : "var(--bg-raised)",
                    color: val ? "var(--green)" : "var(--text-dim)",
                    fontFamily: "var(--font-display)", fontSize: 10, padding: "3px 14px",
                    letterSpacing: 1, transition: "all 0.15s",
                    boxShadow: val ? "0 0 8px var(--green-glow)" : "none",
                  }} disabled={!canToggle}>{val ? "ON" : "OFF"}</button>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 64, height: 6, background: "var(--bg-raised)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${(val || 0) * 100}%`, height: "100%", background: "var(--amber)", transition: "width 0.3s" }} />
                    </div>
                    <code style={{ fontSize: 11, color: "var(--amber)" }}>{((val || 0) * 27648).toFixed(0)}</code>
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const DiagnosticView = ({ events }) => (
  <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 6, fontFamily: "var(--font-mono)" }}>
    {events.length === 0 && <div style={{ color: "var(--text-dim)", fontSize: 12 }}>暂无事件，等待扫描周期触发...</div>}
    {events.map((evt, idx) => (
      <div key={`${evt.ts}-${idx}`} style={{
        display: "grid", gridTemplateColumns: "170px 100px 1fr", gap: 10,
        border: "1px solid var(--border)", background: "var(--bg-raised)", padding: "8px 10px",
      }}>
        <code style={{ color: "var(--cyan)", fontSize: 11 }}>{evt.ts}</code>
        <code style={{ color: evt.level === "FAULT" ? "var(--red)" : "var(--amber)", fontSize: 11 }}>{evt.level}</code>
        <span style={{ color: "var(--text-primary)", fontSize: 12 }}>{evt.msg}</span>
      </div>
    ))}
  </div>
);

// ─── Register / Memory View ────────────────────────────────────────────────
const MemoryView = ({ running }) => {
  const [regs, setRegs] = useState(() =>
    Array.from({ length: 32 }, (_, i) => ({
      addr: `DB1.DBW${i * 2}`,
      name: ["扫描计数器","故障字","运行时间","设定频率","实际频率","电机电流","电机温度","压力PV","温度PV","流量PV","位置反馈","速度给定",
             "PID_SP","PID_PV","PID_OUT","PID_ERR","T1 累计","C1 计数","报警码","状态字"][i] || `数据字_${i}`,
      val: Math.floor(Math.random() * 65535),
      prev: 0,
      changed: false,
    }))
  );

  useInterval(() => {
    if (!running) return;
    setRegs(prev => prev.map(r => {
      const nv = Math.max(0, Math.min(65535, r.val + Math.floor((Math.random() - 0.48) * 12)));
      return { ...r, prev: r.val, val: nv, changed: nv !== r.val };
    }));
  }, 500);

  return (
    <div style={{ padding: 16, fontFamily: "var(--font-mono)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 2 }}>
        {regs.map((r, i) => (
          <div key={r.addr} style={{
            display: "grid", gridTemplateColumns: "140px 60px 80px 80px 1fr",
            alignItems: "center", gap: 8, padding: "5px 12px",
            background: r.changed && running ? "rgba(245,166,35,0.06)" : "transparent",
            borderLeft: `2px solid ${r.changed && running ? "var(--amber)" : "transparent"}`,
            transition: "all 0.2s",
          }}>
            <code style={{ fontSize: 10, color: "var(--cyan)" }}>{r.addr}</code>
            <code style={{ fontSize: 11, color: "var(--amber)", textAlign: "right" }}>{r.val}</code>
            <code style={{ fontSize: 10, color: "var(--text-dim)", textAlign: "right" }}>0x{hex2(r.val >> 8)}{hex2(r.val & 0xff)}</code>
            <code style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: 1 }}>{toBin8(r.val & 0xff)}</code>
            <span style={{ fontSize: 10, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Course Curriculum (来自后端 API，可扩展接入 B 站抓取) ─────────────────────
const LOCAL_FALLBACK_COURSES = [
  { id: "S7-1200-01", vendor: "Siemens", module: "M01", title: "西门子 S7-1200 入门与硬件组态", sub: "TIA Portal · I/O 映射 · OB1 扫描", progress: 60, lessons: 12, level: "Beginner", source: "manual" },
  { id: "S7-1500-02", vendor: "Siemens", module: "M02", title: "西门子 S7-1500 数据块与寄存器", sub: "DB · FC · FB · UDT", progress: 30, lessons: 9, level: "Intermediate", source: "manual" },
  { id: "FX5U-01", vendor: "Mitsubishi", module: "M03", title: "三菱 FX5U 梯形图与高速计数", sub: "GX Works3 · X/Y/M/D", progress: 40, lessons: 10, level: "Beginner", source: "manual" },
  { id: "NJNX-01", vendor: "Omron", module: "M04", title: "欧姆龙 NJ/NX 结构化编程", sub: "Task 周期 · ST/LD 混编", progress: 20, lessons: 8, level: "Intermediate", source: "manual" },
  { id: "ABB-VFD-01", vendor: "ABB", module: "M05", title: "ABB 变频器 ACS 系列调试", sub: "参数映射 · 启停逻辑 · Modbus", progress: 15, lessons: 7, level: "Intermediate", source: "manual" },
  { id: "PLC-IO-ADV", vendor: "Universal", module: "M06", title: "I/O 映射与故障诊断", sub: "DI/DO/AI/AO · 互锁与闭锁", progress: 75, lessons: 6, level: "Beginner", source: "manual" },
];

const useCourses = () => {
  const [courses, setCourses] = useState(LOCAL_FALLBACK_COURSES);
  const [loading, setLoading] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJSON('/courses');
      setCourses(Array.isArray(data.courses) && data.courses.length ? data.courses : LOCAL_FALLBACK_COURSES);
      setBackendOnline(true);
      setError("");
    } catch (err) {
      setBackendOnline(false);
      setError("后端不可达，已回退到本地课程库");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { courses, loading, backendOnline, error, refresh };
};

const CourseView = ({ courses, loading, error, onReload }) => {
  const [selected, setSelected] = useState(null);
  const [vendor, setVendor] = useState("ALL");
  const vendors = ["ALL", ...Array.from(new Set(courses.map(c => c.vendor)))];
  const visible = vendor === "ALL" ? courses : courses.filter(c => c.vendor === vendor);

  return (
    <div style={{ padding: 20, display: "flex", gap: 16, height: "100%" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {vendors.map(v => (
            <button key={v} onClick={() => setVendor(v)} style={{
              border: "1px solid var(--border)", background: vendor === v ? "var(--amber-glow)" : "var(--bg-raised)",
              color: vendor === v ? "var(--amber)" : "var(--text-dim)", cursor: "pointer", padding: "4px 10px", fontSize: 11,
            }}>{v}</button>
          ))}
          <button onClick={onReload} style={{ marginLeft: "auto", border: "1px solid var(--border)", background: "var(--bg-raised)", color: "var(--cyan)", cursor: "pointer", padding: "4px 10px", fontSize: 11 }}>
            {loading ? "同步中..." : "同步课程"}
          </button>
        </div>
        {error && <div style={{ fontSize: 11, color: "var(--amber)" }}>{error}</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, overflow: "auto", paddingRight: 4 }}>
          {visible.map((c, i) => (
            <div key={c.id} onClick={() => setSelected(c)} style={{
              display: "flex", alignItems: "center", gap: 16,
              padding: "14px 18px", cursor: "pointer",
              background: selected?.id === c.id ? "var(--amber-glow)" : "var(--bg-raised)",
              border: `1px solid ${selected?.id === c.id ? "var(--border-bright)" : "var(--border)"}`,
              transition: "all 0.15s", animation: `scanIn 0.2s ease ${i * 0.03}s both`,
            }}>
              <div style={{ width: 64, color: "var(--cyan)", fontSize: 10 }}>{c.vendor}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 14, color: "var(--text-primary)", letterSpacing: 1 }}>{c.title}</div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{c.sub}</div>
              </div>
              <div style={{ width: 140 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{c.lessons} 课时</span>
                  <span style={{ fontSize: 10, color: "var(--amber)" }}>{c.progress}%</span>
                </div>
                <div style={{ height: 3, background: "var(--bg-void)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 2, width: `${c.progress}%`, background: "linear-gradient(90deg, var(--amber-dim), var(--amber))" }}/>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div style={{ width: 320, flexShrink: 0, background: "var(--bg-raised)", border: "1px solid var(--border)", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 11, color: "var(--amber)", letterSpacing: 1 }}>{selected.vendor} · {selected.module || selected.id}</div>
          <div style={{ fontFamily: "var(--font-ui)", fontWeight: 900, fontSize: 18, color: "var(--text-primary)", lineHeight: 1.2 }}>{selected.title}</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.7 }}>{selected.sub}</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>难度：{selected.level || "Beginner"} · 数据源：{selected.source || "manual"}</div>
          {selected.url && (
            <a href={selected.url} target="_blank" rel="noreferrer" style={{ color: "var(--cyan)", fontSize: 12 }}>打开视频源 ↗</a>
          )}
          <div style={{ marginTop: "auto", fontSize: 10, color: "var(--text-muted)", lineHeight: 1.6 }}>
            建议学习路径：硬件组态 → I/O 映射 → 梯形图调试 → 扫描周期优化 → 变频器参数整定。
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Timing Diagram ────────────────────────────────────────────────────────
// I0.0/I0.1/Q0.0/Q0.1/Q0.2 接入真实 ioState；T1.IN 仍用随机仿真
const TimingView = ({ running, ioState, scanInterval }) => {
  const SIGNALS = ["I0.0", "I0.1", "Q0.0", "Q0.1", "Q0.2", "T1.IN"];
  // 哪些信号直接从 ioState 读取（真实值）
  const REAL_SIGS = new Set(["I0.0", "I0.1", "Q0.0", "Q0.1", "Q0.2"]);
  const WIDTH = 600;
  const SAMPLES = 80;
  const [history, setHistory] = useState(() =>
    SIGNALS.map(() => Array.from({ length: SAMPLES }, () => 0))
  );

  useInterval(() => {
    if (!running) return;
    setHistory(prev => prev.map((sig, si) => {
      const name = SIGNALS[si];
      // 真实信号：从 ioState 取当前值追加到历史记录
      if (REAL_SIGS.has(name)) {
        return [...sig.slice(1), ioState[name] ? 1 : 0];
      }
      // 仿真信号（T1.IN）：保持原随机滚动逻辑
      const last = sig[sig.length - 1];
      return [...sig.slice(1), Math.random() < 0.08 ? 1 - last : last];
    }));
  }, scanInterval);

  const step = WIDTH / SAMPLES;
  const H = 30;
  const GAP = 20;

  return (
    <div style={{ padding: 20 }}>
      <div style={{ overflowX: "auto" }}>
        <svg width={WIDTH + 120} height={(H + GAP) * SIGNALS.length + 20} style={{ fontFamily: "var(--font-mono)", overflow: "visible" }}>
          {SIGNALS.map((sig, si) => {
            const y = si * (H + GAP) + 20;
            const pts = history[si];
            return (
              <g key={sig}>
                {/* Label */}
                <text x={0} y={y + H / 2 + 4} fontSize={11} fill="var(--cyan)" textAnchor="start">{sig}</text>
                {/* Background */}
                <rect x={88} y={y} width={WIDTH} height={H} fill="rgba(0,0,0,0.3)" rx="2"/>
                {/* Waveform */}
                <polyline
                  points={pts.map((v, i) => {
                    const x = 88 + i * step;
                    const py = y + (v === 0 ? H - 4 : 4);
                    return `${x},${py}`;
                  }).join(" ")}
                  fill="none"
                  stroke={["var(--cyan)","var(--red)","var(--green)","var(--amber)","var(--amber)","var(--text-dim)"][si]}
                  strokeWidth="1.5"
                />
                {/* Divider */}
                <line x1={0} y1={y + H + GAP / 2} x2={WIDTH + 120} y2={y + H + GAP / 2} stroke="var(--border)" strokeWidth="0.5"/>
              </g>
            );
          })}
          {/* Time axis */}
          {Array.from({ length: 9 }, (_, i) => (
            <g key={i}>
              <line x1={88 + (WIDTH / 8) * i} y1={0} x2={88 + (WIDTH / 8) * i} y2={(H + GAP) * SIGNALS.length + 20} stroke="rgba(245,166,35,0.08)" strokeWidth="1"/>
              <text x={88 + (WIDTH / 8) * i} y={(H + GAP) * SIGNALS.length + 18} fontSize={9} fill="var(--text-dim)" textAnchor="middle">{i * 100}ms</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
};

// ─── Main App ──────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("ladder");
  const [running, setRunning] = useState(true);
  const [scanCount, setScanCount] = useState(0);
  const [scanTime, setScanTime] = useState(8.4);
  const [scanInterval, setScanInterval] = useState(100);
  const [events, setEvents] = useState([]);
  const { courses, loading: loadingCourses, backendOnline, error: courseError, refresh: refreshCourses } = useCourses();
  const prevFaultRef = useRef(false);
  const prevRunRef = useRef(false);
  const [ioState, setIoState] = useState({
    // 初始状态：I0.1(停止按钮)=false 表示未按下，符合实际接线逻辑
    "I0.0": false, "I0.1": false, "I0.2": false, "I0.3": false,
    "I1.0": false, "Q0.0": false, "Q0.1": false, "Q0.2": false, "Q0.3": false,
    "M0.0": false,
    "AIW0": 0.62, "AIW2": 0.35, "AQW0": 0.50,
  });

  // ── 扫描引擎：调用纯函数 runPLCScan，保持 useEffect 职责单一
  // Gemini 架构优化：逻辑与副作用解耦，runPLCScan 可独立单元测试
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setIoState(prev => {
        const next = runPLCScan(prev);
        // 浅比较：仅输出位变化时才触发 re-render，避免无意义扫描
        const changed = ["Q0.0","Q0.1","Q0.2","Q0.3","M0.0"].some(k => next[k] !== prev[k]);
        return changed ? next : prev;
      });
    }, scanInterval);
    return () => clearInterval(id);
  }, [running, scanInterval]);

  useEffect(() => {
    const nowFault = !!ioState["M0.0"];
    const nowRun = !!ioState["Q0.0"];
    const prevFault = prevFaultRef.current;
    const prevRun = prevRunRef.current;

    if (nowFault !== prevFault || nowRun !== prevRun) {
      const entries = [];
      if (nowFault !== prevFault) {
        entries.push({
          ts: new Date().toLocaleTimeString("zh-CN"),
          level: nowFault ? "FAULT" : "INFO",
          msg: nowFault ? "故障激活：急停或热继电器动作，主回路断开" : "故障复位：系统恢复就绪，可重新启动",
        });
      }
      if (nowRun !== prevRun) {
        entries.push({
          ts: new Date().toLocaleTimeString("zh-CN"),
          level: "INFO",
          msg: nowRun ? "接触器吸合：电机运行中" : "接触器释放：电机停止",
        });
      }
      if (entries.length) {
        setEvents(prev => [...entries, ...prev].slice(0, 40));
      }
      prevFaultRef.current = nowFault;
      prevRunRef.current = nowRun;
    }
  }, [ioState]);

  useInterval(() => {
    if (!running) return;
    setScanCount(c => c + 1);
    setScanTime(7.8 + Math.random() * 1.2);
  }, scanInterval);

  const toggleIO = useCallback((addr) => {
    if (!addr.startsWith("I")) return;
    setIoState(prev => ({ ...prev, [addr]: !prev[addr] }));
  }, []);

  const resetSystem = useCallback(() => {
    setIoState(prev => ({ ...prev, "I0.2": false, "I1.0": false, "I0.3": true }));
    setTimeout(() => {
      setIoState(prev => ({ ...prev, "I0.3": false }));
    }, 150);
  }, []);

  const contentMap = {
    ladder: <LadderView ioState={ioState} running={running} />,
    io:     <IOView ioState={ioState} onToggle={toggleIO} />,
    memory: <MemoryView running={running} />,
    course: <CourseView courses={courses} loading={loadingCourses} error={courseError} onReload={refreshCourses} />,
    course: <CourseView />,
    timing: <TimingView running={running} ioState={ioState} scanInterval={scanInterval} />,
    diag:   <DiagnosticView events={events} />,
  };

  return (
    <div className="plc-root" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <GlobalStyles />
      <TopBar
        scanCount={scanCount}
        scanTime={scanTime}
        running={running}
        onToggle={() => setRunning(r => !r)}
        scanInterval={scanInterval}
        onIntervalChange={setScanInterval}
        onReset={resetSystem}
        backendOnline={backendOnline}
      />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <Sidebar active={tab} onChange={setTab} />
        <div style={{ flex: 1, overflow: "auto" }}>
          <Panel
            title={NAV_ITEMS.find(n => n.id === tab)?.label}
            subtitle={NAV_ITEMS.find(n => n.id === tab)?.sub}
            style={{ minHeight: "100%" }}
            actions={
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: running ? "var(--green)" : "var(--red)",
                  boxShadow: running ? "0 0 8px var(--green)" : "0 0 8px var(--red)",
                  animation: running ? "blink 2s infinite" : "none",
                }}/>
                <span style={{ fontSize: 10, color: "var(--text-dim)", letterSpacing: 1 }}>
                  {running ? "LIVE · 实时刷新中" : "PAUSED · 已暂停"}
                </span>
              </div>
            }
          >
            {contentMap[tab]}
          </Panel>
        </div>
      </div>
    </div>
  );
}
