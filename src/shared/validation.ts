import { z } from 'zod'
import { platformIds } from './contracts'
const id = z.string().min(1).max(160)
const platform = z.enum(platformIds)
const label = z.string().trim().min(1).max(40)
const bounds = z.object({ x: z.number().int().min(0).max(20000), y: z.number().int().min(0).max(20000), width: z.number().int().min(1).max(20000), height: z.number().int().min(1).max(20000) }).strict()
const account = (type: string) => z.object({ type: z.literal(type), accountId: id }).strict()
const task = (type: string) => z.object({ type: z.literal(type), taskId: id }).strict()
const course = (type: string) => z.object({ type: z.literal(type), courseId: id }).strict()
export const commandSchema = z.union([
 z.object({ type: z.literal('account.add'), platform, label }).strict(),
 z.object({ type: z.literal('account.rename'), accountId: id, label }).strict(),
 ...['account.open','account.check','account.logout','account.delete','courses.refresh'].map(account),
 ...['course.open','course.chapters'].map(course),
 z.object({ type: z.literal('task.add'), courseId: id, chapterIds: z.array(id).max(300) }).strict(),
 ...['queue.start','queue.pause'].map(type => z.object({ type: z.literal(type), platform }).strict()),
 ...['task.pause','task.resume','task.cancel'].map(task),
 z.object({ type: z.literal('task.reorder'), taskId: id, direction: z.enum(['up','down']) }).strict(),
 z.object({ type: z.literal('view.show'), platform, bounds }).strict(),
 z.object({ type: z.literal('view.hide') }).strict(),
 z.object({ type: z.literal('view.navigate'), platform, action: z.enum(['back','reload','home']) }).strict(),
 z.object({ type: z.literal('view.close'), platform }).strict(),
 z.object({ type: z.literal('settings.update'), settings: z.object({ muteAll: z.boolean().optional(), audiblePlatform: platform.optional(), closeToTray: z.boolean().optional(), reminderEnabled: z.boolean().optional(), reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), breakEnabled: z.boolean().optional(), breakMinutes: z.number().int().min(5).max(180).optional() }).strict() }).strict(),
 ...['notices.read','diagnostics.export','data.clear-history','app.quit'].map(type => z.object({ type: z.literal(type) }).strict())
])
