const path = require('path')
const common = require('./webpack.common.js')
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin')
const CopyWebpackPlugin = require('copy-webpack-plugin')

module.exports = Object.assign(common, {
  mode: 'production',
	entry: {
		main: './src/comfy.ts',
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

module.exports.plugins.push(
  new CopyWebpackPlugin({
    patterns: [
      {
        from: 'csv/*.csv', 
        to: (pathData) => {
            console.log(pathData)
            return path.join(pathData.context, "comfy", path.basename(pathData.absoluteFilename))
        }
      },
    ]
  })
)
 /*
 module.exports.module.rules.push({
  test: /api\.js$/,
  type: 'asset/resource',
 })
 */
