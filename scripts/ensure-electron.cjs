const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises');const {Readable,Transform}=require('node:stream');
(async()=>{
 const dir=path.dirname(require.resolve('electron/package.json'));const pkg=require(path.join(dir,'package.json'));const name='electron-v'+pkg.version+'-win32-x64.zip';const zip=path.join(process.cwd(),'.cache',name);fs.mkdirSync(path.dirname(zip),{recursive:true});
 const sums=require(path.join(dir,'checksums.json'));const expected=sums[name];if(!expected)throw Error('Missing pinned checksum');
 const hash=async(file)=>{const h=crypto.createHash('sha256');await pipeline(fs.createReadStream(file),new Transform({transform(c,e,cb){h.update(c);cb()}}));return h.digest('hex')};
 if(!fs.existsSync(zip)||await hash(zip)!==expected){
  console.log('Downloading pinned Electron binary from the official GitHub release…');const r=await fetch('https://github.com/electron/electron/releases/download/v'+pkg.version+'/'+name,{signal:AbortSignal.timeout(300000)});if(!r.ok)throw Error('HTTP '+r.status);let bytes=0,last=Date.now();await pipeline(Readable.fromWeb(r.body),new Transform({transform(c,e,cb){bytes+=c.length;if(Date.now()-last>5000){console.log(Math.round(bytes/1048576)+' MiB downloaded');last=Date.now()}cb(null,c)}}),fs.createWriteStream(zip));
 }
 const actual=await hash(zip);if(actual!==expected)throw Error('Checksum mismatch');console.log('SHA-256 verified:',actual);
 const {execFileSync}=require('node:child_process');const dist=path.join(dir,'dist');fs.mkdirSync(dist,{recursive:true});execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Expand-Archive -LiteralPath '"+zip.replaceAll("'","''")+"' -DestinationPath '"+dist.replaceAll("'","''")+"' -Force"],{stdio:'inherit',windowsHide:true});fs.writeFileSync(path.join(dir,'path.txt'),'electron.exe');console.log('Verified Electron runtime is ready.');
})().catch(e=>{console.error(e);process.exitCode=1});
