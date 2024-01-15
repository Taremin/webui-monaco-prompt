const path = require('path')
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin')

module.exports = {
	entry: {
		main: './src/main.ts',
	},
	resolve: {
		extensions: ['.ts', '.js', 'tsx']
	},
	output: {
		filename: '[name].bundle.js',
		library: 'MonacoPrompt',
		libraryTarget: 'umd',
		path: path.resolve(__dirname, 'javascript')
	},
	module: {
		rules: [
			{
				test: /\.(ts|tsx)?$/,
				use: 'ts-loader',
				exclude: /node_modules/
			},
			{
				test: /\.(css)$/,
				use: ['style-loader', 'css-loader'],
				include: /node_modules/
			},
			{
				test: /\.css$/,
				use: [
					'style-loader',
					{
						loader:'css-loader',
						options: {
							modules: {
								localIdentName: '[name]__[local]___[hash:base64:5]',
							}
						}
					}
				],
				exclude: /node_modules/
			},
			{
				test: /\.ttf$/,
				type: 'asset/resource',
				generator: {
					filename: "[name][ext]"
				}
			}
		],
		parser: {
			javascript: { importMeta: false },
		},
	},
	plugins: [
        new MonacoWebpackPlugin({
			languages: [],
        })
	]
};
