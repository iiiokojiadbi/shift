import { resolve } from 'node:path'
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base'
import { projectAt } from '../adapters/npm/store'
import { sizeReport } from '../core/src/sizes'

const root = resolve(process.argv[2] ?? '.')
console.log(await sizeReport(await projectAt(root), text => countTokens(text, { disallowedSpecial: new Set() })))
