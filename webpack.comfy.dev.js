 const common = require('./webpack.comfy.js');

 module.exports = Object.assign(common, {
   mode: 'development',
   devtool: 'inline-source-map',
 })
