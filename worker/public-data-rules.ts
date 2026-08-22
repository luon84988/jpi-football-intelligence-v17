export const PUBLIC_DATA_RULES = {
  version: "1.0.0",
  sources: [
    { id:"official", tier:"S", use:["球队身份","赛程","积分榜","注册名单","官方伤停/停赛"], rule:"联赛、俱乐部或赛事组织官方页面优先" },
    { id:"football-data", tier:"A", use:["球队目录","官方积分榜","赛程赛果"], rule:"只接受带稳定 competition/team id 的结构化记录" },
    { id:"statsbomb-open", tier:"A", use:["历史阵容","事件数据","球员作用模型"], rule:"仅限开放比赛覆盖；保留来源署名和比赛ID" },
    { id:"thesportsdb", tier:"B", use:["队徽","球场","球队别名","基础球员资料"], rule:"作为补充源，不单独确认伤停和转会" },
    { id:"public-media", tier:"C", use:["伤停线索","转会线索","教练表态"], rule:"必须有发布日期、原文链接，并由另一独立来源交叉确认" },
  ],
  identity: { required:["source","source_team_id","canonical_name","country","league"], matchOrder:["稳定ID","官方名称+国家","别名+联赛"], reject:["仅凭中文简称合并","跨赛季同名自动合并"] },
  freshnessHours: { fixture:6, standings:24, squad:72, injury:12, transfer:24, profile:720 },
  validation: [
    { id:"DQ-01", rule:"来源URL、抓取时间、源ID缺一即拒绝入主表" },
    { id:"DQ-02", rule:"比分、积分、排名必须通过范围和单调性校验" },
    { id:"DQ-03", rule:"同字段冲突时按 S>A>B>C；同级取更新时间更新者，并保留冲突记录" },
    { id:"DQ-04", rule:"伤停、停赛、转会必须至少一个S/A源，或两个相互独立的C源" },
    { id:"DQ-05", rule:"阵容与球员动态超过时效窗口自动降级，不参与正式分析" },
    { id:"DQ-06", rule:"缺失数值保持 null，禁止用0或编造均值替代" },
    { id:"DQ-07", rule:"批次球队数较基线下降超过10%时拒绝覆盖，保留上一有效版本" },
    { id:"DQ-08", rule:"每条派生评分保存模型版本、输入字段和证据等级" },
  ],
  publishGate: { officialAnalysis:["identity_pass","freshness_pass","no_material_conflict","source_tier_A_or_better"], preAnalysis:"未满足正式门槛时只显示待验证，不修正xG或风险评级" },
};

export function assessPublicRecord(record:any){const reasons:string[]=[];if(!record?.source||!record?.sourceUrl)reasons.push("missing_source");if(!record?.sourceTeamId)reasons.push("missing_stable_id");if(!record?.canonicalName||!record?.league)reasons.push("missing_identity");const age=record?.fetchedAt?(Date.now()-new Date(record.fetchedAt).getTime())/36e5:Infinity;if(age>(PUBLIC_DATA_RULES.freshnessHours as any)[record?.dataType||"profile"])reasons.push("stale");return{accepted:reasons.length===0,grade:reasons.length?"REJECT":"PASS",reasons,rulesVersion:PUBLIC_DATA_RULES.version}}
