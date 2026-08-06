/**
 * Build config for the read-only public audience and fullscreen display application.
 *
 * This is intentionally a small standalone browser bundle. It shares only plain DTO types with
 * the Electron app and never bundles the admin renderer, room credentials, or MODAQ.
 */

import path from 'path';
import webpack from 'webpack';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import CssMinimizerPlugin from 'css-minimizer-webpack-plugin';
import TerserPlugin from 'terser-webpack-plugin';
import webpackPaths from './webpack.paths';
import checkNodeEnv from '../scripts/check-node-env';

checkNodeEnv('production');

const srcLivePath = path.join(webpackPaths.srcPath, 'live');
const distLivePath = path.join(webpackPaths.distPath, 'live');

const configuration: webpack.Configuration = {
  devtool: 'source-map',
  mode: 'production',
  target: 'web',
  entry: [path.join(srcLivePath, 'index.tsx')],
  output: {
    path: distLivePath,
    publicPath: '/live/',
    filename: 'live.js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            compilerOptions: { module: 'esnext' },
          },
        },
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.jsx', '.json', '.ts', '.tsx'],
    modules: [webpackPaths.srcPath, 'node_modules'],
    alias: {
      react: path.join(webpackPaths.rootPath, 'node_modules/react'),
      'react-dom': path.join(webpackPaths.rootPath, 'node_modules/react-dom'),
    },
  },
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin(), new CssMinimizerPlugin()],
  },
  performance: { hints: false },
  plugins: [
    new webpack.EnvironmentPlugin({ NODE_ENV: 'production' }),
    new MiniCssExtractPlugin({ filename: 'live.css' }),
    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: path.join(srcLivePath, 'index.ejs'),
      minify: { collapseWhitespace: true, removeComments: false },
    }),
  ],
};

export default configuration;
