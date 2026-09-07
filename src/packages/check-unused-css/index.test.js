const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { checkUnusedCss } = require('./index')

function writeFixture({ css, markup }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unused-css-'))
  fs.writeFileSync(path.join(dir, 'page.styles.css'), css)
  fs.writeFileSync(path.join(dir, 'page.template.html'), markup)
  return {
    dir,
    config: {
      css: [path.join(dir, '*.styles.css')],
      content: [path.join(dir, '*.template.html')],
      safelist: { standard: [], deep: [], greedy: [] },
    },
  }
}

async function runCheck(fixture) {
  const exitCodes = []
  const exit = jest.spyOn(process, 'exit').mockImplementation((code) => {
    exitCodes.push(code)
  })
  const log = jest.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await checkUnusedCss({ config: fixture.config })
    return { exitCodes, output: log.mock.calls.map((args) => args.join(' ')).join('\n') }
  } finally {
    exit.mockRestore()
    log.mockRestore()
    fs.rmSync(fixture.dir, { recursive: true, force: true })
  }
}

describe('checkUnusedCss', () => {
  it('passes when every class in the stylesheet appears in the markup', async () => {
    const { exitCodes, output } = await runCheck(
      writeFixture({
        css: '.card { color: red; }\n',
        markup: '<div class="card"></div>\n',
      }),
    )
    expect(exitCodes).toEqual([])
    expect(output).toContain('All CSS classes are in use')
  })

  it('fails and names the class when the markup never uses it', async () => {
    const { exitCodes, output } = await runCheck(
      writeFixture({
        css: '.card { color: red; }\n.ghost { color: blue; }\n',
        markup: '<div class="card"></div>\n',
      }),
    )
    expect(exitCodes).toEqual([1])
    expect(output).toContain('.ghost')
    expect(output).not.toContain('.card\n')
  })

  it('suppresses a single selector marked with an inline ignore', async () => {
    const { exitCodes } = await runCheck(
      writeFixture({
        css: '/* purgecss-ignore: composed at runtime */\n.ghost { color: blue; }\n',
        markup: '<div></div>\n',
      }),
    )
    expect(exitCodes).toEqual([])
  })

  it('suppresses every selector between an ignore-start and ignore-end pair', async () => {
    const { exitCodes } = await runCheck(
      writeFixture({
        css: [
          '/* purgecss-ignore-start: composed at runtime */',
          '.status--working,',
          '.status--failed {',
          '  color: blue;',
          '}',
          '/* purgecss-ignore-end */',
          '.ghost { color: red; }',
          '',
        ].join('\n'),
        markup: '<div></div>\n',
      }),
    )
    expect(exitCodes).toEqual([1])
  })

  it('reports only the selectors outside the ignored block', async () => {
    const { output } = await runCheck(
      writeFixture({
        css: [
          '/* purgecss-ignore-start: composed at runtime */',
          '.status--working { color: blue; }',
          '/* purgecss-ignore-end */',
          '.ghost { color: red; }',
          '',
        ].join('\n'),
        markup: '<div></div>\n',
      }),
    )
    expect(output).toContain('.ghost')
    expect(output).not.toContain('.status--working')
  })

  it('exits non-zero when purgecss cannot read the configured stylesheet', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {})
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await checkUnusedCss({ config: { css: [null], content: [] } })
      expect(exit).toHaveBeenCalledWith(1)
      expect(error).toHaveBeenCalled()
    } finally {
      exit.mockRestore()
      log.mockRestore()
      error.mockRestore()
    }
  })
})
