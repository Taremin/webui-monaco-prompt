const path = require('path')
const common = require('./webpack.common.js')
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin')
const CopyWebpackPlugin = require('copy-webpack-plugin')

const projectRootDir = path.dirname(__filename)

module.exports = Object.assign({}, common, {
  mode: 'production',
  entry: {
    main: './src/comfyui/index.ts',
  },
  resolve: {
    extensions: ['.ts', '.js', 'tsx']
  },
  experiments: {
    outputModule: true,
  },
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, 'comfy'),
    publicPath: "",
    library: {
      type: "module",
    },
    chunkFormat: "module",
  },
  externalsType: 'module',
  externals: {
    "../../scripts/app.js": "../../scripts/app.js",
    "../../scripts/api.js": "../../scripts/api.js",
    "../../scripts/ui.js": "../../scripts/ui.js",
  },
  plugins: [
    new MonacoWebpackPlugin({
      filename: '[name].worker.mjs',
      languages: [],
    }),
  ]
})

const staticPathFormat = path.join(projectRootDir, "comfy", "[name][ext]")
module.exports.plugins.push(
  new CopyWebpackPlugin({
    patterns: [
      {
        from: 'csv/*.csv',
        to: staticPathFormat
      },
      {
        from: 'src/comfyui/static/*',
        to: staticPathFormat
      }
    ]
  })
)
