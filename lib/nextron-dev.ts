import arg from 'arg'
import execa from 'execa'
import webpack from 'webpack'
import * as logger from './logger'
import { getNextronConfig } from './configs/getNextronConfig'
import { config } from './configs/webpack.config.development'
import type { ChildProcess } from 'child_process'

const args = arg({
  '--renderer-port': Number,
  '--run-only': Boolean,
  '--startup-delay': Number,
  '--electron-options': String,

  // removed since v8.11.0
  '--port': Number,
  '--remote-debugging-port': Number,
  '--inspect': Number,
})

if (args['--port']) {
  logger.error(
    `The option \`--port\` has been removed. Please use \`--renderer-port ${args['--port']}\` instead.`
  )
  process.exit(1)
}

if (args['--remote-debugging-port']) {
  logger.error(
    `The option \`--remote-debugging-port\` has been removed. Please use \`--electron-options="--remote-debugging-port=${args['--remote-debugging-port']}"\` instead.`
  )
  process.exit(1)
}

if (args['--inspect']) {
  logger.error(
    `The option \`--inspect\` has been removed. Please use \`--electron-options="--inspect=${args['--inspect']}"\` instead.`
  )
  process.exit(1)
}

const nextronConfig = getNextronConfig()

const rendererPort = args['--renderer-port'] || 8888
const startupDelay = nextronConfig.startupDelay || args['--startup-delay'] || 0

let electronOptions = args['--electron-options'] || ''
if (!electronOptions.includes('--remote-debugging-port')) {
  electronOptions += ' --remote-debugging-port=5858'
}
if (!electronOptions.includes('--inspect')) {
  electronOptions += ' --inspect=9292'
}
electronOptions = electronOptions.trim()

const execaOptions: execa.Options = {
  cwd: process.cwd(),
  stdio: 'inherit',
}

;(async () => {
  let firstCompile = true
  let watching: webpack.Watching
  let mainProcess: ChildProcess
  let rendererProcess: ChildProcess // eslint-disable-line prefer-const

  const startMainProcess = () => {
    logger.info(
      `Run main process: electron . ${rendererPort} ${electronOptions}`
    )
    mainProcess = execa(
      'electron',
      ['.', `${rendererPort}`, `${electronOptions}`],
      {
        detached: true,
        ...execaOptions,
      }
    )
    mainProcess.on('exit', (code) => {
      logger.info('main process exit')
    })
    // 开发模式下, render 是作为服务进程而不是静态资源启动,
    // 故当主进程退出时, 开发模式应处理渲染进程的退出
    mainProcess.on('close', (code) => {
      logger.info('main process closed')
      killWholeProcess()
    })
    mainProcess.unref()
  }

  const startRendererProcess = () => {
    logger.info(
      `Run renderer process: next -p ${rendererPort} ${
        nextronConfig.rendererSrcDir || 'renderer'
      }`
    )
    const child = execa(
      'next',
      ['-p', rendererPort, nextronConfig.rendererSrcDir || 'renderer'],
      execaOptions
    )
    child.on('close', () => {
      logger.info('render process closed')
      // process.exit(0)
      killWholeProcess()
    })
    child.on('exit', (code) => {
      logger.info(`render process exit, ${code}`)
    })
    return child
  }

  const killWholeProcess = () => {
    logger.info('kill Whole Process')
    watching?.close(() => {})
    mainProcess?.kill()
    rendererProcess?.kill()
  }

  process.on('SIGINT', killWholeProcess)
  process.on('SIGTERM', killWholeProcess)
  process.on('exit', killWholeProcess)

  rendererProcess = startRendererProcess()

  // wait until renderer process is ready
  await new Promise<void>((resolve) =>
    setTimeout(() => resolve(), startupDelay)
  )

  // wait until main process is ready
  await new Promise<void>((resolve) => {
    const compiler = webpack(config)
    watching = compiler.watch({}, (error) => {
      if (error) {
        console.error(error.stack || error)
      }

      if (!args['--run-only']) {
        if (!firstCompile && mainProcess) {
          mainProcess.kill()
        }
        startMainProcess()

        if (firstCompile) {
          firstCompile = false
        }
      }

      resolve()
    })
  })

  if (args['--run-only']) {
    startMainProcess()
  }
})()
