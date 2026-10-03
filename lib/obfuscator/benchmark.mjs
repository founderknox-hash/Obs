import { performance } from 'node:perf_hooks'
import { compileSource } from './compiler.ts'
import { DEFAULT_OPTIONS } from './types.ts'
import fs from 'node:fs'
import path from 'node:path'

const dir=process.argv[2] || path.resolve('benchmarks/roblox')
const files=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>/\.(lua|luau)$/i.test(f)).map(f=>path.join(dir,f)):[]
if(!files.length){ console.log(JSON.stringify({message:'No Roblox benchmark scripts found.',directory:dir},null,2)); process.exit(0) }
for(const file of files){
  const source=fs.readFileSync(file,'utf8'); const before=process.memoryUsage().rss; const t0=performance.now();
  const result=compileSource(source,DEFAULT_OPTIONS,true); const compileMs=performance.now()-t0; const after=process.memoryUsage().rss;
  console.log(JSON.stringify({file,inputBytes:result.stats.inputBytes,outputBytes:result.stats.outputBytes,instructions:result.stats.instructions,constants:result.stats.constants,compileMs:Math.round(compileMs*100)/100,peakRssDeltaBytes:Math.max(0,after-before)}))
}
