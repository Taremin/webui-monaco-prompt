const path = require('path')
const common = require('./webpack.common.js')
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin')
const CopyWebpackPlugin = require('copy-webpack-plugin')

const projectRootDir = path.dirname(__filename)

module.exports = Object.assign(common, {
  mode: 'production',
	entry: {
		main: './src/comfyui/index.ts',
	},
	resolve: {
		extensions: ['.ts', '.js', 'tsx']
	},
	output: {
		filename: '[name].bundle.js',
		library: 'MonacoPrompt',
		libraryTarget: 'umd',
		path: path.resolve(__dirname, 'comfy'),
    publicPath: "",
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
 /*
 module.exports.module.rules.push({
  test: /api\.js$/,
  type: 'asset/resource',
 })
 */
