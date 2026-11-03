import type { StudyInterval } from '../../shared/contracts'
export function aggregateIntervals(intervals: StudyInterval[], from: number, to: number): { playbackMs: number; elapsedMs: number } {
 const ranges = intervals.map(i => [Math.max(from, i.start), Math.min(to, i.end)] as const).filter(([s,e])=>Number.isFinite(s)&&Number.isFinite(e)&&e>s).sort((a,b)=>a[0]-b[0]);
 let playbackMs=0, elapsedMs=0, left=0, right=0
 for (const [s,e] of ranges) { playbackMs += e-s; if(s>right){ elapsedMs += Math.max(0,right-left); left=s; right=e } else { right=Math.max(right,e) } }
 elapsedMs += Math.max(0,right-left)
 return { playbackMs, elapsedMs }
}
export function localDayStart(now=Date.now()): number { const d=new Date(now); d.setHours(0,0,0,0); return d.getTime() }
