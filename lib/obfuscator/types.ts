export type CompilerOptions = {
  encodeStrings: boolean
  randomizeOpcodes: boolean
  packBytecode: boolean
  flattenControlFlow: boolean
  renameIdentifiers: boolean
  compactOutput: boolean
}

export type CompileResult = {
  mode: 'vm' | 'compatibility' | 'native'
  warnings: string[]
  output: string
  stats: {
    inputBytes: number
    outputBytes: number
    instructions: number
    constants: number
    handlers: number
    durationMs: number
  }
  protections: (keyof CompilerOptions)[]
  buildId: string
}

export const DEFAULT_OPTIONS: CompilerOptions = {
  encodeStrings: true,
  randomizeOpcodes: true,
  packBytecode: true,
  flattenControlFlow: true,
  renameIdentifiers: true,
  compactOutput: true,
}

export const MAX_SOURCE_BYTES = 10 * 1024 * 1024

export const EXAMPLE_SOURCE = `-- Welcome to Obsidian.
-- Your logic. Your ownership.

local Players = game:GetService("Players")
local playerCount = #Players:GetPlayers()

local config = {
    name = "My Roblox experience",
    maxPlayers = 24,
    version = "1.0.0"
}

print("Starting " .. config.name)
print("Version: " .. config.version)

if playerCount < config.maxPlayers then
    print("There is room for more players!")
else
    print("This server is full.")
end

return config
`
