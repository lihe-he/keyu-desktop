import { randomUUID } from 'node:crypto'
import type { Command, Notice, Settings } from '../../shared/contracts'
import type { Repository } from './repository'
import { aggregateIntervals, localDayStart } from './stats'

type SettingsPatch = Extract<Command, { type: 'settings.update' }>['settings']
const stamp = (d: Date): string => [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-')
// Calendar days, not elapsed 24-hour periods: local DST changes must not lose a reminder.
const ordinal = (d: Date): number => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000

export class ReminderService {
 constructor(private repo: Repository, private notify: (n: Notice) => void, private clock: () => number = Date.now) {}
 private add(title: string, body: string): void {
  const n: Notice = { id: randomUUID(), level: 'info', title, body, createdAt: this.clock(), read: false }
  this.repo.saveNotice(n); this.notify(n)
 }
 updateSettings(patch: SettingsPatch): Settings {
  const previous = this.repo.settings(), next = { ...previous, ...patch }
  if (next.reminderEnabled !== previous.reminderEnabled || next.reminderTime !== previous.reminderTime) {
   // Start from the user's explicit choice; never backfill time before enabling/change.
   next.reminderCursorAt = next.reminderEnabled ? this.clock() : 0
   next.lastReminderDate = ''
  }
  if (!previous.breakEnabled && next.breakEnabled) next.lastBreakAt = this.clock()
  this.repo.saveSettings(next)
  return next
 }
 tick(): void {
  const now = this.clock(), settings = this.repo.settings()
  let changed = false
  if (settings.reminderEnabled) {
   const [h, m] = settings.reminderTime.split(':').map(Number)
   const latest = new Date(now); latest.setHours(h, m, 0, 0)
   if (latest.getTime() > now) latest.setDate(latest.getDate() - 1)
   // Existing pre-cursor installations have no evidence of earlier enabled dates.
   const cursor = settings.reminderCursorAt || localDayStart(now) - 1
   const first = new Date(cursor); first.setHours(h, m, 0, 0)
   if (first.getTime() <= cursor) first.setDate(first.getDate() + 1)
   if (latest.getTime() >= first.getTime() && settings.lastReminderDate !== stamp(latest)) {
    const count = ordinal(latest) - ordinal(first) + 1
    const missed = count > 1 || now - latest.getTime() > 120000
    const body = count > 1
     ? `应用未运行期间共错过 ${count} 次学习提醒（${stamp(first)} 至 ${stamp(latest)}，每天 ${settings.reminderTime}）。已合并显示，不会自动播放课程。`
     : `${stamp(latest)} 安排的学习时间是 ${settings.reminderTime}。按自己的节奏开始，提醒不会自动播放课程。`
    this.add(missed ? '错过的学习提醒' : '到学习时间了', body)
    settings.lastReminderDate = stamp(latest)
    settings.reminderCursorAt = latest.getTime()
    changed = true
   } else if (!settings.reminderCursorAt) {
    settings.reminderCursorAt = now; changed = true
   }
  }
  if (settings.breakEnabled) {
   const from = Math.max(localDayStart(now), settings.lastBreakAt)
   const elapsed = aggregateIntervals(this.repo.intervals(from), from, now).elapsedMs
   if (elapsed >= settings.breakMinutes * 60000) {
    this.add('休息一下吧', `已观察到约 ${settings.breakMinutes} 分钟的不重复播放时间，建议起身活动、让眼睛休息。`)
    settings.lastBreakAt = now; changed = true
   }
  }
  if (changed) this.repo.saveSettings(settings)
 }
}
