'use client'
import {useMemo,useState} from 'react'

const matches=[
 {league:'英超',time:'22:00',home:'Northbridge FC',away:'Riverside United',dq:'A',edge:'+8.4%',risk:'B',signal:'主胜',score:'2–1',pdi:0.72,draw:'轻度',odds:['1.78','3.65','4.60']},
 {league:'西甲',time:'00:30',home:'Real Costa',away:'Athletic Norte',dq:'B',edge:'+5.1%',risk:'C',signal:'小 2.5',score:'1–0',pdi:0.41,draw:'中度',odds:['2.08','3.10','3.75']},
 {league:'意甲',time:'02:45',home:'Milano Rosso',away:'Torino Blu',dq:'A',edge:'+11.2%',risk:'A',signal:'主 -0.75',score:'2–0',pdi:0.86,draw:'无',odds:['1.62','3.90','5.70']},
 {league:'德甲',time:'21:30',home:'Rhine 04',away:'Berlin Adler',dq:'C',edge:'—',risk:'D',signal:'回避',score:'—',pdi:0.18,draw:'强预警',odds:['2.34','3.55','2.82']}
]
const stages=['数据质量门','球队实力','球员影响力','战意指数 MDI','赛程轮换 SRS','理论盘口','亚盘审计','Bet365 分歧','泊松进球','平局猎物','证据融合','风险控制','输出引擎','回测引擎','持续学习']

export default function Home(){
 const [active,setActive]=useState(0); const [filter,setFilter]=useState('全部');
 const rows=useMemo(()=>filter==='全部'?matches:matches.filter(x=>x.risk===filter),[filter]); const m=matches[active]
 return <main>
  <header><div className="brand"><span className="mark">JPi</span><div><b>FOOTBALL INTELLIGENCE</b><small>OS V17.0 · EVIDENCE FUSION TERMINAL</small></div></div><div className="status"><i/> SYSTEM ONLINE <span>DEMO DATA · 非临场</span></div></header>
  <nav><a className="on">市场总览</a><a>比赛分析</a><a>盘口雷达</a><a>平局猎物</a><a>回测中心</a><a>模型设置</a><button>＋ 新建分析</button></nav>
  <section className="ticker"><span>DATA QUALITY <b>87.4</b></span><span>MODEL HIT RATE <b>68.2%</b></span><span>ACTIVE SIGNALS <b>12</b></span><span>HIGH RISK <em>3</em></span><span>LAST SYNC <b>21:42:08</b></span><span className="warn">⚠ 竞彩数据可能滞后 2–8 小时</span></section>
  <div className="shell">
   <section className="workspace">
    <div className="title"><div><small>MARKET OVERVIEW</small><h1>今日比赛信号台</h1></div><div className="filters">{['全部','A','B','C','D'].map(x=><button key={x} className={filter===x?'sel':''} onClick={()=>setFilter(x)}>{x==='全部'?x:`风险 ${x}`}</button>)}</div></div>
    <div className="kpis"><article><small>可执行机会</small><strong>08</strong><span className="up">▲ 2 今日新增</span></article><article><small>平均价值偏离</small><strong>+7.6%</strong><span>理论盘 vs 实盘</span></article><article><small>平局预警</small><strong>04</strong><span className="amber">1 强 · 2 中 · 1 轻</span></article><article><small>结构混乱</small><strong className="red">03</strong><span>建议回避</span></article></div>
    <div className="panel table"><div className="panelhead"><b>实时比赛矩阵</b><span>示例数据 · 点击比赛查看证据链</span></div><div className="thead"><span>赛事 / 时间</span><span>对阵</span><span>公平欧赔</span><span>PDI</span><span>价值</span><span>风险</span><span>核心信号</span></div>{rows.map((x,i)=><button className={'match '+(matches[active]===x?'active':'')} key={x.home} onClick={()=>setActive(matches.indexOf(x))}><span><b>{x.league}</b><small>{x.time}</small></span><span className="teams"><b>{x.home}</b><small>{x.away}</small></span><span className="odds">{x.odds.join('  ')}</span><span><i className="meter"><i style={{width:`${x.pdi*100}%`}}/></i>{x.pdi}</span><span className="up">{x.edge}</span><span><i className={'badge r'+x.risk}>{x.risk}</i></span><span><b>{x.signal}</b><small>{x.draw}平局</small></span></button>)}</div>
    <div className="rule"><b>RULE INTEGRITY</b><span>正式分析必须完整执行 15 个引擎节点；任何缺失自动降级为 Pre-Analysis。</span><strong>15 / 15 READY</strong></div>
   </section>
   <aside>
    <div className="panel detail"><div className="panelhead"><b>信号解剖</b><span className="live">● SELECTED</span></div><small>{m.league} · {m.time}</small><h2>{m.home}<i>VS</i>{m.away}</h2><div className="verdict"><small>综合判断</small><strong>{m.signal}</strong><span>核心比分 {m.score}</span></div><div className="gauges"><div><small>实力差</small><b>+18</b></div><div><small>战意 MDI</small><b>82</b></div><div><small>PDI</small><b>{m.pdi}</b></div><div><small>风险</small><b className={'txt'+m.risk}>{m.risk}</b></div></div>
     <h3>证据融合</h3><ul><li><i className="pos"/>主证据：实力与阵容形成同向支撑</li><li><i className="pos"/>盘口证据：理论盘高于实盘</li><li><i className="neg"/>反证据：客队低位防守稳定</li><li><i className="warnDot"/>风险证据：非临场首发待确认</li></ul>
     <div className="allocation"><span>建议仓位</span><b>{m.risk==='D'?'0% · 回避':'1.0% · 轻仓'}</b></div><p className="legal">演示内容仅用于展示分析流程，不构成投注或财务建议。</p>
    </div>
    <div className="panel pipeline"><div className="panelhead"><b>模型流水线</b><span>ALL RULES</span></div>{stages.map((x,i)=><div key={x}><i>{String(i+1).padStart(2,'0')}</i><span>{x}</span><b>✓</b></div>)}</div>
   </aside>
  </div>
 </main>
}
