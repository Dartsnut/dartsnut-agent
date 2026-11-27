// Additional webpack config for the Dartsnut bridge entrypoint.
//
// This file is placed into the upstream checkout by the regeneration script and
// is not part of upstream. It extends upstream's own generated build config, so
// every module rule, provide, define, and copy plugin is inherited rather than
// re-derived: a bridge that drifted from the editor's asset handling would fail
// in ways upstream's build would not.

const path = require('path');

const HtmlWebpackPlugin = require('html-webpack-plugin');

const upstream = require('./webpack.config.js');
const base = Array.isArray(upstream) ? upstream[0] : upstream;

module.exports = Object.assign({}, base, {
    entry: {
        dartsnut: path.join(__dirname, 'dartsnut-gui.jsx')
    },
    output: Object.assign({}, base.output, {
        path: path.resolve(__dirname, 'build')
    }),
    plugins: [
        ...base.plugins,
        new HtmlWebpackPlugin({
            chunks: ['dartsnut'],
            filename: 'dartsnut.html',
            template: 'src/playground/index.ejs',
            title: 'Dartsnut Scratch Editor'
        })
    ]
});
