import { join } from 'node:path'

// Local launch flag only; not exposed over IPC and never enables fixture mode.
// A UUID cannot select an arbitrary directory or the user's normal account store.
export function verificationProfilePath(id: string, temp: string): string {
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))throw new Error('校验目录标识无效，已停止启动；未访问日常账号数据。')
 return join(temp,'CampusCourseDesktop-verification',id)
}
