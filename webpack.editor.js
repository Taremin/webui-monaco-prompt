const path = require('path')
const common = require('./webpack.common.js')

module.exports = Object.assign(
	common,
	{
		mode: 'development',
		entry: {
			index: './src/index.ts',
		},
		output: {
			filename: '[name].bundle.js',
			library: 'MonacoPrompt',
			libraryTarget: 'umd',
			path: path.resolve(__dirname, 'dist')
		},
	}
)
