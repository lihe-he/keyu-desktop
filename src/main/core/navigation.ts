import type { PlatformId } from '../../shared/contracts'
import { courseIdentityUrl, isDirectoryCourse } from './security'

// Only the observed legacy redirect from a freshly resolved v24 entry may be
// retried over TLS. This is not an HTTP allowlist; the HTTP request stays blocked.
export function courseHttpsRetry(platform:PlatformId,source:string,target:string):string|null {
 try {
  if(!isDirectoryCourse(platform,source)||!courseIdentityUrl(platform,source)||!new URL(source).searchParams.get('ckenc'))return null
  const u=new URL(target)
  if(u.protocol!=='http:'||u.hostname!=='mooc1.chaoxing.com'||u.pathname!=='/visit/stucoursemiddle'||u.port||u.username||u.password||u.hash)return null
  u.protocol='https:';return u.href
 }catch{return null}
}

// Diagnostics contain only static labels. Never echo an unknown host, path,
// query, fragment, username or a raw Electron error message.
const hosts = new Set(['passport2.chaoxing.com','i.chaoxing.com','i.mooc.chaoxing.com','v24.chaoxing.com','mooc1.chaoxing.com','mooc1-1.chaoxing.com','mooc1-2.chaoxing.com','mooc2.chaoxing.com','mooc2-ans.chaoxing.com'])
const paths = new Set(['/','/login','/space/index','/courselist/opencoursenewfy','/mooc-ans/visit/stucoursemiddle','/visit/stucoursemiddle','/mycourse/studentcourse','/mycourse/studentstudy','/mooc-ans/mycourse/studentcourse','/mooc-ans/mycourse/studentstudy','/mooc2-ans/mycourse/stu','/mooc-ans/mycourse/stu','/mooc-ans/knowledge/cards'])
export type NavigationStage = 'redirect' | 'navigate' | 'new-window'
export function blockedNavigationMessage(platform:PlatformId,raw:string,isMainFrame:boolean,stage:NavigationStage,loginPage:boolean):string {
 let http=false,host='未列出的站点',path='未列出的页面'
 try {const u=new URL(raw);http=u.protocol==='http:';if(platform==='chaoxing'){if(hosts.has(u.hostname))host=u.hostname;if(paths.has(u.pathname))path=u.pathname}}catch{}
 const reason=http?'不安全的 HTTP 页面':'未验证的页面'
 const action=loginPage&&isMainFrame?'手机确认后可点“手机已确认，核对登录”，无需先重复扫码。':'请保留此提示，等待核对平台兼容性；无需因此重新扫码。'
 const step=stage==='redirect'?'服务端重定向':stage==='new-window'?'新窗口':'页面导航'
 return `已阻止跳转至${reason}。${action}（${isMainFrame?'主页面':'嵌套页面'} · ${step} · 站点 ${host} · 路径 ${path}）`
}

export function pageLoadFailure(error:unknown):string {
 const code=typeof error==='object'&&error!==null&&'errno' in error?error.errno:undefined
 const suffix=typeof code==='number'&&Number.isInteger(code)&&code<0&&code>=-1000?`（错误代码 ${code}）`:''
 return `平台页面未能加载${suffix}，请检查网络或稍后重试。`
}
