'use client'
import {useEffect,useMemo,useState} from 'react'

const fallbackMatches=[
 {league:'英超',time:'22:00',home:'Northbridge FC',away:'Riverside United',dq:'A',edge:'+8.4%',risk:'B',signal:'主胜',score:'2–1',pdi:0.72,draw:'轻度',odds:['1.78','3.65','4.60']},
 {league:'西甲',time:'00:30',home:'Real Costa',away:'Athletic Norte',dq:'B',edge:'+5.1%',risk:'C',signal:'小 2.5',score:'1–0',pdi:0.41,draw:'中度',odds:['2.08','3.10','3.75']},
 {league:'意甲',time:'02:45',home:'Milano Rosso',away:'Torino Blu',dq:'A',edge:'+11.2%',risk:'A',signal:'主 -0.75',score:'2–0',pdi:0.86,draw:'无',odds:['1.62','3.90','5.70']},
 {league:'德甲',time:'21:30',home:'Rhine 04',away:'Berlin Adler',dq:'C',edge:'—',risk:'D',signal:'回避',score:'—',pdi:0.18,draw:'强预警',odds:['2.34','3.55','2.82']}
]
const stages=['数据质量门','球队实力','球员影响力','战意指数 MDI','赛程轮换 SRS','理论盘口','亚盘审计','Bet365 分歧','泊松进球','平局猎物','证据融合','风险控制','输出引擎','回测引擎','持续学习']

export default function Home(){
 const [matches,setMatches]=useState(fallbackMatches); const [active,setActive]=useState(0); const [filter,setFilter]=useState('全部');
 const [region,setRegion]=useState('全部赛事'); const [query,setQuery]=useState('');
 const [sync,setSync]=useState({loading:true,live:false,time:null,message:'正在获取比赛数据'});
 const refresh=async()=>{setSync(s=>({...s,loading:true,message:'正在同步'}));try{const res=await fetch('/api/football/live',{cache:'no-store'});if(!res.ok)throw new Error(`HTTP ${res.status}`);const data=await res.json();if(data.matches?.length){setMatches(data.matches);setActive(0);setSync({loading:false,live:true,time:new Date(data.updatedAt),message:`已同步 ${data.matches.length} 场`})}else throw new Error('暂无可用赛程')}catch{setSync(s=>({...s,loading:false,live:false,message:'实时源不可用，显示回退数据'}))}};
 useEffect(()=>{refresh();const timer=setInterval(refresh,5*60*1000);return()=>clearInterval(timer)},[])
 const rows=useMemo(()=>matches.filter(x=>(filter==='全部'||x.risk===filter)&&(region==='全部赛事'||x.group===region)&&(!query||`${x.league}${x.home}${x.away}`.toLowerCase().includes(query.toLowerCase()))),[matches,filter,region,query]); const m=matches[active]||matches[0]
 return <main>
  <header><div className="brand"><span className="mark">JPi</span><div><b>FOOTBALL INTELLIGENCE</b><small>OS V17.0 · EVIDENCE FUSION TERMINAL</small></div></div><div className="status"><i/> SYSTEM ONLINE <span>{sync.live?'LIVE FIXTURES · 自动更新':'FALLBACK DATA · 非临场'}</span></div></header>
  <nav><a className="on">市场总览</a><a>比赛分析</a><a>盘口雷达</a><a>平局猎物</a><a>回测中心</a><a>模型设置</a><button>＋ 新建分析</button></nav>
  <section className="ticker"><span>DATA QUALITY <b>{sync.live?'LIVE':'87.4'}</b></span><span>MODEL HIT RATE <b>68.2%</b></span><span>ACTIVE MATCHES <b>{matches.length}</b></span><span>HIGH RISK <em>{matches.filter(x=>x.risk==='D').length}</em></span><span>LAST SYNC <b>{sync.time?sync.time.toLocaleTimeString('zh-CN',{hour12:false}):'--:--:--'}</b></span><button className="syncBtn" onClick={refresh} disabled={sync.loading}>{sync.loading?'同步中…':'↻ 刷新数据'}</button><span className="warn">{sync.message}</span></section>
  <div className="shell">
   <section className="workspace">
    <div className="title"><div><small>MARKET OVERVIEW</small><h1>今日比赛信号台</h1></div><div className="filters">{['全部','A','B','C','D'].map(x=><button key={x} className={filter===x?'sel':''} onClick={()=>setFilter(x)}>{x==='全部'?x:`风险 ${x}`}</button>)}</div></div>
    <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>{['全部赛事','日韩联赛','欧洲顶级','欧洲次级','欧洲洲际'].map(x=><button key={x} className={region===x?'sel':''} onClick={()=>setRegion(x)} style={{background:region===x?'#17394a':'#0c151e',color:region===x?'#66e3c4':'#8da2ad',border:'1px solid #213442',padding:'8px 12px',borderRadius:4,cursor:'pointer'}}>{x}</button>)}<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索联赛或球队" style={{marginLeft:'auto',minWidth:190,background:'#081018',border:'1px solid #213442',color:'#d8e1e8',padding:'8px 12px',borderRadius:4}}/></div>
    <div className="kpis"><article><small>已采集比赛</small><strong>{matches.length}</strong><span className="up">覆盖 {new Set(matches.map(x=>x.league)).size} 个联赛</span></article><article><small>当前筛选</small><strong>{rows.length}</strong><span>{region}</span></article><article><small>赛前分析</small><strong>{matches.filter(x=>x.state==='pre').length}</strong><span className="amber">自动生成初筛信号</span></article><article><small>数据风险</small><strong className="red">{matches.filter(x=>x.risk==='D').length}</strong><span>缺失信息自动降级</span></article></div>
    <div className="panel table"><div className="panelhead"><b>实时比赛矩阵</b><span>{sync.live?'公开赛程源 · 每 5 分钟自动更新':'回退数据 · 点击比赛查看证据链'}</span></div><div className="thead"><span>赛事 / 时间</span><span>对阵</span><span>状态 / 比分</span><span>PDI</span><span>价值</span><span>风险</span><span>核心信号</span></div>{rows.map((x,i)=><button className={'match '+(matches[active]===x?'active':'')} key={`${x.home}-${x.away}-${x.time}`} onClick={()=>setActive(matches.indexOf(x))}><span><b>{x.league}</b><small>{x.time}</small></span><span className="teams"><b>{x.home}</b><small>{x.away}</small></span><span className="odds">{x.status||x.odds.join('  ')}</span><span><i className="meter"><i style={{width:`${x.pdi*100}%`}}/></i>{x.pdi}</span><span className="up">{x.edge}</span><span><i className={'badge r'+x.risk}>{x.risk}</i></span><span><b>{x.signal}</b><small>{x.draw}平局</small></span></button>)}</div>
    <div className="rule"><b>RULE INTEGRITY</b><span>正式分析必须完整执行 15 个引擎节点；任何缺失自动降级为 Pre-Analysis。</span><strong>15 / 15 READY</strong></div>
   </section>
   <aside>
    <div className="panel detail"><div className="panelhead"><b>信号解剖</b><span className="live">● SELECTED</span></div><small>{m.league} · {m.time}</small><h2>{m.home}<i>VS</i>{m.away}</h2><div className="verdict"><small>综合判断</small><strong>{m.signal}</strong><span>核心比分 {m.score}</span></div><div className="gauges"><div><small>实力差</small><b>+18</b></div><div><small>战意 MDI</small><b>82</b></div><div><small>PDI</small><b>{m.pdi}</b></div><div><small>风险</small><b className={'txt'+m.risk}>{m.risk}</b></div></div>
     <h3>自动分析摘要</h3><ul><li><i className="pos"/>数据层级：{m.group||'演示'} · {m.tier||'未分级'}</li><li><i className="pos"/>赛程状态：{m.status||'待更新'}</li><li><i className="neg"/>模型结论：{m.signal}，置信指标 {m.pdi}</li><li><i className="warnDot"/>风险证据：阵容、伤停与临场指数仍需二次确认</li></ul>
     <div className="allocation"><span>建议仓位</span><b>{m.risk==='D'?'0% · 回避':'1.0% · 轻仓'}</b></div><p className="legal">演示内容仅用于展示分析流程，不构成投注或财务建议。</p>
    </div>
    <div className="panel pipeline"><div className="panelhead"><b>模型流水线</b><span>ALL RULES</span></div>{stages.map((x,i)=><div key={x}><i>{String(i+1).padStart(2,'0')}</i><span>{x}</span><b>✓</b></div>)}</div>
   </aside>
  </div>
 </main>
}
