import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join } from 'node:path'
import which from 'which'

const WINDOWS_SCRIPT_EXTENSIONS = new Set(['.cmd', '.bat'])

export function resolveCliPath(bin: string): string | undefined {
  const resolved = which.sync(bin, { nothrow: true }) ?? undefined
  if (!resolved || process.platform !== 'win32' || !WINDOWS_SCRIPT_EXTENSIONS.has(extname(resolved).toLowerCase())) {
    return resolved
  }
  // Provider SDKs spawn this path directly, while Windows npm shims require
  // cmd.exe. Resolve the shim to a target the SDK can launch without a shell.
  const script = npmShimScript(resolved)
  if (!script) return undefined
  return bin === 'codex' ? codexNativeExecutable(script) : script
}

function npmShimScript(shimPath: string): string | undefined {
  try {
    const contents = readFileSync(shimPath, 'utf8')
    const match = contents.match(/%~?dp0%?[\\/]([^"\r\n]+\.(?:[cm]?js))/i)
    if (!match?.[1]) return undefined
    const relativePath = match[1].split(/[\\/]/).filter(Boolean)
    const target = join(dirname(shimPath), ...relativePath)
    return existsSync(target) ? target : undefined
  } catch {
    return undefined
  }
}

function codexNativeExecutable(scriptPath: string): string | undefined {
  const packageRoot = dirname(dirname(scriptPath))
  const packageJson = join(packageRoot, 'package.json')
  if (!existsSync(packageJson)) return undefined
  const target = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
  const platformPackage = process.arch === 'arm64' ? '@openai/codex-win32-arm64' : '@openai/codex-win32-x64'
  try {
    // The Codex SDK spawns its override as a native command, so its JS entrypoint
    // is not sufficient here. Follow the installed package to its platform binary.
    const platformPackageJson = createRequire(packageJson).resolve(`${platformPackage}/package.json`)
    const vendorRoot = join(dirname(platformPackageJson), 'vendor', target)
    for (const candidate of [join(vendorRoot, 'bin', 'codex.exe'), join(vendorRoot, 'codex', 'codex.exe')]) {
      if (existsSync(candidate)) return candidate
    }
  } catch {
    return undefined
  }
  return undefined
}
