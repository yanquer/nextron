import webpack from 'webpack'
import { getWebpackConfig } from './helpers'

const compiler = webpack(getWebpackConfig('production'))

compiler.run((err, stats) => {
  if (err) {
    console.error(err.stack || err)
  }
  if (stats) {
    if (stats.hasErrors()) {
      console.error(stats.toString())
    } else {
      console.log(stats.toString())
    }
  }
})