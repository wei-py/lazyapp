import { writeFile } from 'node:fs/promises'
import { createGenerator } from '@unocss/core'
import presetIcons from '@unocss/preset-icons'

const names = ['default-file', 'file-type-image', 'file-type-pdf2', 'file-type-json', 'file-type-text', 'file-type-zip', 'file-type-video', 'file-type-audio', 'file-type-key', 'file-type-cert', 'file-type-font', 'file-type-excel', 'file-type-word', 'file-type-markdown', 'file-type-xml']
const generator = await createGenerator({ presets: [presetIcons({ scale: 1.8 })] })
const { css } = await generator.generate(names.map(name => `i-vscode-icons-${name}`).join(' '))
const license = `VSCode Icons — https://github.com/vscode-icons/vscode-icons
The MIT License (MIT)
Copyright The vscode-icons Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`
await writeFile(new URL('../src/web/public/icons.css', import.meta.url), `/* ${license} */\n${css}\n`)
