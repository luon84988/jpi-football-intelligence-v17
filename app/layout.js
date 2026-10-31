import './globals.css'
import './gateway.css'
const title='JPi Football Intelligence OS V18.0 Hybrid'
const description='V17冠军内核与V18融合挑战者双轨运行的足球概率、证据审计、风险控制与回测终端。'

export const metadata={
 metadataBase:new URL('https://jpi-football-intelligence-v17.luonan.chatgpt.site'),
 title,
 description,
 openGraph:{title,description,type:'website',images:[{url:'/og.png',width:1200,height:630,alt:title}]},
 twitter:{card:'summary_large_image',title,description,images:['/og.png']}
}
export default function Layout({children}){return <html lang="zh-CN"><body>{children}</body></html>}
