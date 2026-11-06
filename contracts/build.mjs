// Writes abi/<Name>.json (committed, read by pi/ and web/) from the contracts in src/.
// The contracts themselves are built, tested and deployed in Arc Studio (see STUDIO.md);
// `forge test` runs the same tests locally.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import solc from "solc"

const files = readdirSync("src").filter((f) => f.endsWith(".sol"))
const input = {
  language: "Solidity",
  sources: Object.fromEntries(files.map((f) => [`src/${f}`, { content: readFileSync(`src/${f}`, "utf8") }])),
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi"] } },
  },
}
// @openzeppelin/contracts comes from node_modules (npm install)
const findImports = (path) => {
  const p = `node_modules/${path}`
  return existsSync(p) ? { contents: readFileSync(p, "utf8") } : { error: `not found: ${path}` }
}
const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }))
const errors = (out.errors || []).filter((e) => e.severity === "error")
for (const e of out.errors || []) console.log(e.formattedMessage)
if (errors.length) process.exit(1)

mkdirSync("abi", { recursive: true })
for (const f of files) {
  const name = f.replace(/\.sol$/, "")
  const c = out.contracts[`src/${f}`][name]
  writeFileSync(`abi/${name}.json`, JSON.stringify(c.abi, null, 1) + "\n")
  console.log(`abi/${name}.json (${c.abi.length} entries)`)
}
