// Local check build. The real deploy happens in Arc Studio (paste the .sol files there).
// Writes abi/<Name>.json (committed, used by pi/ and web/) and build/<Name>.json (bytecode, ignored).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import solc from "solc"

const sol = (dir) => readdirSync(dir).filter((f) => f.endsWith(".sol")).map((f) => (dir === "." ? f : `${dir}/${f}`))
const files = [...sol("."), ...sol("test")]
const input = {
  language: "Solidity",
  sources: Object.fromEntries(files.map((f) => [f, { content: readFileSync(f, "utf8") }])),
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
}
const out = JSON.parse(solc.compile(JSON.stringify(input)))
const errors = (out.errors || []).filter((e) => e.severity === "error")
for (const e of out.errors || []) console.log(e.formattedMessage)
if (errors.length) process.exit(1)

mkdirSync("abi", { recursive: true })
mkdirSync("build", { recursive: true })
for (const [file, contracts] of Object.entries(out.contracts)) {
  for (const [name, c] of Object.entries(contracts)) {
    if (name === "IERC20") continue
    writeFileSync(`build/${name}.json`, JSON.stringify({ abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }))
    if (!file.startsWith("test/")) writeFileSync(`abi/${name}.json`, JSON.stringify(c.abi, null, 1) + "\n")
    console.log(`built ${name} (${c.evm.bytecode.object.length / 2} bytes)`)
  }
}
