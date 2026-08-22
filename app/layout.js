import './globals.css'
const title='JPi Football Intelligence OS V17.0'
const description='专业足球智能分析、证据融合、风险控制与回测学习终端。'

export const metadata={
 title,
 description,
 openGraph:{title,description,type:'website',images:[{url:'/og.png',width:1200,height:630,alt:title}]},
 twitter:{card:'summary_large_image',title,description,images:['/og.png']}
}
export default function Layout({children}){return <html lang="zh-CN"><body>{children}</body></html>}
