const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
    entry: path.join(__dirname, 'src/index.js'),
    devtool: false,
    output: {
        path: path.join(__dirname, 'dist/'),
        filename: 'index.js',
    },
    resolve: {
        extensions: ['.js'],
    },
    module: {
        rules: [
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader'],
            },
            {
                test: /\.html$/,
                use: { loader: 'html-loader' },
            },
        ],
    },
    plugins: [],
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin({ extractComments: false, terserOptions: { mangle: false } }),
        ],
    },
    performance: {
        hints: false,
    },
};
