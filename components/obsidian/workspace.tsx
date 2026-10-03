'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Braces, Check, ChevronRight, CircleHelp, Code2, Copy, Cpu, FileCode2, Fingerprint, FlaskConical, Hexagon, Loader2, LockKeyhole, Menu, RotateCcw, Shield, Sparkles, Terminal, Upload, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { DEFAULT_OPTIONS, EXAMPLE_SOURCE, MAX_SOURCE_BYTES, type CompileResult, type CompilerOptions } from '@/lib/obfuscator/types'
import { CodeEditor } from './code-editor'
import { ProtectionPanel } from './protection-panel'
import { DocsDialog } from './docs-dialog'

function formatBytes(bytes: number) { return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB` }

export function Workspace() {
  const [source, setSource] = useState(EXAMPLE_SOURCE)
  const [filename, setFilename] = useState('script.lua')
  const [options, setOptions] = useState<CompilerOptions>(DEFAULT_OPTIONS)
  const [result, setResult] = useState<CompileResult | null>(null)
  const [requireVM, setRequireVM] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState('source')
  const [docs, setDocs] = useState(false)
  const [release, setRelease] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [dragging, setDragging] = useState(false)
  const upload = useRef<HTMLInputElement>(null)
  const inputBytes = new TextEncoder().encode(source).length

  useEffect(() => { setReady(true) }, [])

  function updateSource(value: string) {
    setSource(value); setResult(null); setError(''); setNotice('')
  }
  function updateOptions(value: CompilerOptions) {
    setOptions(value); setResult(null); setTab('source'); setError(''); setNotice('')
  }
  function openDocs() { setRelease(false); setDocs(true); setMobileNav(false) }

  async function readFile(file?: File) {
    if (!file || busy) return
    if (!/\.(lua|luau)$/i.test(file.name)) { setError('Choose a .lua or .luau source file.'); return }
    if (file.size > MAX_SOURCE_BYTES) { setError('This file exceeds the 10 MB source limit.'); return }
    try { updateSource(await file.text()); setFilename(file.name); setTab('source') }
    catch { setError('Could not read this file. Please try uploading it again.') }
  }

  async function compile() {
    if (busy || !source.trim()) return
    setBusy(true); setError(''); setNotice(''); setResult(null)
    try {
      const response = await fetch('/api/obfuscate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, options, requireVM, mode: requireVM ? 'vm' : 'native' }), signal: AbortSignal.timeout(30000),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Compilation failed. Please try again.')
      setResult(data); setNotice(data.mode === 'vm' ? 'VM build complete. Your output is ready.' : 'Native Luau build ready. No runtime loader required.'); setTab('output')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the compiler. Please try again.')
      setTab('source')
    } finally { setBusy(false) }
  }

  async function copy() {
    if (!result) return
    try { await navigator.clipboard.writeText(result.output); setNotice('Output copied to clipboard.') }
    catch { setError('Clipboard access is unavailable. Use Download instead.') }
  }

  function download() {
    if (!result) return
    const url = URL.createObjectURL(new Blob([result.output], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = filename.replace(/\.(lua|luau)$/i, '') + '.obfuscated.lua'
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice('Your output download has started.')
  }

  return (
    <div className="app-shell" data-ready={ready}>
      <aside className={cn('sidebar', mobileNav && 'sidebar-open')}>
        <a href="/" className="brand"><div className="brand-icon"><Hexagon className="size-7" strokeWidth={1.7} /><span /></div><span>obsidian<span className="brand-period">.</span></span></a>
        <div className="workspace-label"><span className="workspace-avatar"><Braces className="size-4" /></span><div><strong>Personal workspace</strong><span>Luau development</span></div><ChevronRight className="ml-auto size-3.5 text-muted-foreground" /></div>
        <div className="nav-section-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button className="nav-item active" onClick={() => { setDocs(false); setMobileNav(false) }} aria-current="page"><Shield className="size-4" />Obfuscator<span className="nav-active-dot" /></button>
          <button className="nav-item" onClick={openDocs}><BookOpen className="size-4" />Documentation<ArrowUpRight className="ml-auto size-3.5" /></button>
          <button className="nav-item" onClick={() => { setRelease(true); setDocs(true); setMobileNav(false) }}><Sparkles className="size-4" />Changelog<span className="new-dot" /></button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note"><span className="mini-icon"><Terminal className="size-4" /></span><h3>Built for your next big thing.</h3><p>Keep your code yours.<br />Start with the essentials.</p><button onClick={openDocs}>Explore the compiler <ArrowRight className="size-3.5" /></button></div>
          <button className="nav-item" onClick={openDocs}><CircleHelp className="size-4" />Help & resources<ArrowUpRight className="ml-auto size-3.5" /></button>
          <div className="sidebar-version"><span className="status-dot" />Compiler v0.5.0<span className="ml-auto">BETA</span></div>
        </div>
      </aside>
      {mobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <div className="main-shell">
        <header className="topbar">
          <div className="flex items-center gap-3"><Button variant="ghost" size="icon" className="mobile-menu" aria-label={mobileNav ? 'Close navigation' : 'Open navigation'} onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X /> : <Menu />}</Button><span className="breadcrumb-parent">Workspace</span><ChevronRight className="size-3 text-muted-foreground" /><span>Obfuscator</span></div>
          <div className="flex items-center gap-4"><span className="topbar-status"><span className="status-dot" />Standalone output</span><span className="topbar-divider" /><a href="https://luau.org" target="_blank" rel="noreferrer" className="topbar-link">Made for Luau <ArrowUpRight className="size-3.5" /></a></div>
        </header>
        <main className="workspace-main">
          <div className="page-intro"><div><div className="flex items-center gap-2.5"><h1>Your code. Under cover.</h1><Badge variant="outline">BETA</Badge></div><p>Full Luau frontend with VM-only protected builds; native Luau output remains available separately.</p></div><Button variant="outline" onClick={openDocs}><BookOpen data-icon="inline-start" />Quick start<ArrowUpRight data-icon="inline-end" /></Button></div>
          <div className="pipeline-banner"><div className="pipeline-icon"><Cpu className="size-4" /></div><div><strong>{requireVM ? 'A different VM. Every build.' : 'Your Luau. No loader required.'}</strong><span>{requireVM ? ' Packed bytecode. Shuffled control flow. On-demand decoding.' : ' Native syntax. Compiler-validated. Roblox-ready output.'}</span></div><span className="pipeline-tag"><span className="status-dot" />{requireVM ? 'VM-powered' : 'Native Luau'}</span></div>
          <div className="workbench">
            <section className="editor-panel panel" aria-label="Script workspace" onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void readFile(e.dataTransfer.files[0]) }}>
              <Tabs value={tab} onValueChange={value => setTab(String(value))} className="editor-tabs">
                <div className="editor-toolbar"><TabsList variant="line"><TabsTrigger value="source"><Code2 />Source code</TabsTrigger><TabsTrigger value="output"><Terminal />Output{result && <span className="status-dot" />}</TabsTrigger></TabsList><div className="flex items-center gap-1"><Button variant="ghost" size="sm" aria-label="Upload source file" onClick={() => upload.current?.click()} disabled={busy}><Upload data-icon="inline-start" /><span className="upload-label">Upload file</span></Button><Button variant="ghost" size="icon-sm" aria-label="Clear source" title="Clear source" onClick={() => { updateSource(''); setTab('source') }} disabled={busy || !source}><X /></Button></div></div>
                <div className="file-bar"><span className="flex min-w-0 items-center gap-2"><FileCode2 className="size-3.5 shrink-0 text-primary" /><span className="truncate">{tab === 'source' ? filename : filename.replace(/\.(lua|luau)$/i, '') + '.obfuscated.lua'}</span><span className="file-dot" /></span><span className="text-muted-foreground">{tab === 'source' ? 'Luau' : 'Generated Luau'}</span></div>
                <TabsContent value="source" className="editor-tab-content"><CodeEditor label="Luau source code" value={source} onChange={updateSource} readOnly={busy} /></TabsContent>
                <TabsContent value="output" className="editor-tab-content">{result ? <CodeEditor label="Obfuscated Luau output" value={result.output} readOnly /> : <div className="output-empty"><div><LockKeyhole className="size-6" /></div><h3>Your next layer of protection.</h3><p>{requireVM ? 'Generate bytecode and a standalone Luau virtual machine.' : 'Validate and transform Luau without a runtime loader.'}</p><span>{requireVM ? 'Source → Bytecode → Virtual machine' : 'Source → Validate → Native Luau'}</span></div>}</TabsContent>
                <div className="editor-statusbar"><span className="flex items-center gap-2"><span className="status-dot" />{busy ? 'Compiling…' : result ? 'Build complete' : 'Ready to compile'}</span><span>{tab === 'source' ? `${source.split('\n').length} lines` : `${result?.stats.instructions ?? 0} instructions`}<span className="status-separator">|</span>UTF-8<span className="status-separator">|</span>{formatBytes(tab === 'output' ? result?.stats.outputBytes ?? 0 : inputBytes)}</span></div>
              </Tabs>
              {dragging && <div className="drop-overlay"><Upload className="size-8" /><span>Drop your Luau script here</span></div>}
              <input ref={upload} type="file" accept=".lua,.luau" className="sr-only" aria-label="Upload Luau file" onChange={e => { void readFile(e.target.files?.[0]); e.target.value = '' }} />
              <div className="editor-actions"><Button variant="ghost" size="sm" disabled={busy} onClick={() => { updateSource(EXAMPLE_SOURCE); setFilename('script.lua'); setTab('source') }}><RotateCcw data-icon="inline-start" />Load example</Button><div className="flex items-center gap-2">{result && <Button variant="outline" onClick={download}><ArrowDownToLine data-icon="inline-start" />Download</Button>}<Button size="lg" disabled={!ready || busy || !source.trim() || inputBytes > MAX_SOURCE_BYTES} onClick={compile} className="compile-button">{busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Zap data-icon="inline-start" />}{busy ? 'Compiling…' : 'Obfuscate script'}{!busy && <ArrowRight data-icon="inline-end" />}</Button></div></div>
            </section>
            <ProtectionPanel options={options} onChange={updateOptions} onDocs={openDocs} disabled={busy} requireVM={requireVM} onRequireVMChange={value => { setRequireVM(value); setResult(null); setError(''); setNotice(''); setTab('source') }} />
          </div>
          <div aria-live="polite" className="build-feedback">{error ? <Alert variant="destructive"><FlaskConical /><AlertTitle>Could not complete this build</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : result ? <div className="build-success"><div><Check className="size-4" /><span>{notice}</span></div><div className="build-metrics"><span>{result.protections.length} passes</span><span>{result.stats.instructions} instructions</span><span>{result.stats.durationMs} ms</span><Button variant="ghost" size="sm" onClick={copy}><Copy data-icon="inline-start" />Copy output</Button></div></div> : <div className="privacy-note"><LockKeyhole className="size-3.5" /><span>Your source is compiled, never executed or saved by this app.</span><span className="source-limit">10 MB source limit</span></div>}</div>
          {result && result.mode !== 'vm' && <Alert><FlaskConical /><AlertTitle>{result.mode === 'native' ? 'Native Luau — source-level protection' : 'Source-loader fallback — reduced protection'}</AlertTitle><AlertDescription><ul className="flex list-disc flex-col gap-2 pl-4">{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></AlertDescription></Alert>}
          {inputBytes > MAX_SOURCE_BYTES && <p role="alert" className="text-sm text-destructive">Source exceeds 10 MB. Reduce the script size to compile.</p>}
          <section className="under-the-hood"><div className="section-heading"><span className="eyebrow">UNDER THE HOOD</span><span>A different shape. The same logic.</span></div><div className="feature-grid">
            <div className="feature-card"><div className="feature-icon"><Cpu className="size-4" /></div><div><h3>Virtualized execution</h3><p>Compiles supported source into bytecode that runs inside its own interpreter.</p></div><span className="feature-number">01</span></div>
            <div className="feature-card"><div className="feature-icon"><Fingerprint className="size-4" /></div><div><h3>No two builds alike</h3><p>Fresh opcode variants, operand layouts, register mappings, and VM symbols on each default build.</p></div><span className="feature-number">02</span></div>
            <div className="feature-card"><div className="feature-icon"><Braces className="size-4" /></div><div><h3>One self-contained script</h3><p>Native Luau and VM builds need no runtime loader. VM mode supports functions, closures, and callbacks. Use native mode for types and Luau-specific syntax.</p></div><span className="feature-number">03</span></div>
          </div></section>
          <footer className="workspace-footer"><span>OBSIDIAN <span className="footer-slash">/</span> Built to keep your work, yours.</span><button onClick={openDocs}><FlaskConical className="size-3.5" />Experimental compiler · View limitations<ArrowUpRight className="size-3" /></button></footer>
        </main>
      </div>
      <DocsDialog open={docs} onOpenChange={setDocs} releaseNotes={release} />
    </div>
  )
}
