import Database from 'better-sqlite3'
import { mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Account, Course, Task, Settings, Notice, StudyInterval } from '../shared/contracts'
import { defaultSettings } from '../shared/contracts'
import type { Repository } from './core/repository'
export class Store implements Repository {
 private db: Database.Database
 constructor(file: string) {
  mkdirSync(dirname(file), { recursive: true }); this.db = new Database(file)
  this.db.pragma('foreign_keys = ON'); this.db.pragma('busy_timeout = 5000')
  const version = this.db.pragma('user_version', { simple: true }) as number
  if (version > 1) { this.db.close(); throw new Error('数据库来自较新的应用版本，请使用新版应用打开。') }
  if (version < 1) {
   if (existsSync(file) && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length) copyFileSync(file, file + '.before-v1.bak')
   this.db.transaction(() => {
    this.db.exec(`CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, platform TEXT NOT NULL, payload TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS courses(id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, payload TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, payload TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS intervals(id INTEGER PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, platform TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL CHECK(end >= start));
     CREATE INDEX IF NOT EXISTS interval_end ON intervals(end);
     CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS notices(id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, payload TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY, created_at INTEGER NOT NULL, event TEXT NOT NULL, payload TEXT NOT NULL);
     PRAGMA user_version = 1;`)
   })()
  }
  this.db.pragma('journal_mode = WAL')
 }
 private all<T>(table: string): T[] { return (this.db.prepare('SELECT payload FROM '+table).all() as {payload:string}[]).map(r=>JSON.parse(r.payload) as T) }
 accounts(): Account[] { return this.all<Account>('accounts') }
 saveAccount(a: Account): void { this.db.prepare('INSERT INTO accounts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(a.id,a.platform,JSON.stringify(a)) }
 removeAccount(id: string): void { this.db.prepare('DELETE FROM accounts WHERE id=?').run(id) }
 courses(accountId?: string): Course[] { const all=this.all<Course>('courses'); return accountId ? all.filter(c=>c.accountId===accountId) : all }
 saveCourses(courses: Course[]): void { const statement=this.db.prepare('INSERT INTO courses VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload'); this.db.transaction(()=>{for(const c of courses)statement.run(c.id,c.accountId,JSON.stringify(c))})() }
 tasks(): Task[] { return this.all<Task>('tasks').sort((a,b)=>a.position-b.position||a.createdAt-b.createdAt) }
 saveTask(t: Task): void { this.db.prepare('INSERT INTO tasks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(t.id,t.accountId,JSON.stringify(t)) }
 settings(): Settings { const s=this.db.prepare('SELECT payload FROM settings WHERE id=1').get() as {payload:string}|undefined; return {...defaultSettings,...(s?JSON.parse(s.payload):{})} }
 saveSettings(s: Settings): void { this.db.prepare('INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(JSON.stringify(s)) }
 notices(): Notice[] { return this.all<Notice>('notices').sort((a,b)=>b.createdAt-a.createdAt) }
 saveNotice(n: Notice): void { this.db.transaction(()=>{ this.db.prepare('INSERT INTO notices VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(n.id,n.createdAt,JSON.stringify(n)); this.db.exec('DELETE FROM notices WHERE id NOT IN (SELECT id FROM notices ORDER BY created_at DESC LIMIT 200)') })() }
 readNotices(): void { this.db.transaction(()=>{for(const n of this.notices())this.saveNotice({...n,read:true})})() }
 addInterval(i: StudyInterval): void { if(i.end>i.start)this.db.prepare('INSERT INTO intervals(task_id,platform,start,end) VALUES(?,?,?,?)').run(i.taskId,i.platform,i.start,i.end) }
 intervals(from: number): StudyInterval[] { return this.db.prepare('SELECT task_id as taskId,platform,start,end FROM intervals WHERE end>? ORDER BY start').all(from) as StudyInterval[] }
 log(event: string, data: Record<string,unknown>={}): void {
  // Callers pass identifiers and enumerated event codes only, never page text or credentials.
  this.db.prepare('INSERT INTO logs(created_at,event,payload) VALUES(?,?,?)').run(Date.now(),event,JSON.stringify(data))
  this.db.exec('DELETE FROM logs WHERE id < (SELECT COALESCE(MAX(id),0)-2000 FROM logs)')
 }
 logs(): unknown[] { return this.db.prepare('SELECT created_at,event,payload FROM logs ORDER BY id DESC LIMIT 500').all() }
 clearHistory(): void {
  this.db.transaction(()=>{ for(const t of this.tasks())if(['finished','cancelled'].includes(t.status))this.db.prepare('DELETE FROM tasks WHERE id=?').run(t.id); this.db.exec('DELETE FROM intervals; DELETE FROM notices; DELETE FROM logs;') })()
 }
 close(): void { this.db.pragma('wal_checkpoint(TRUNCATE)'); this.db.close() }
}
