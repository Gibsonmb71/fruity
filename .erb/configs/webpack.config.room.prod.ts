/**
 * Build config for the browser room application.
 *
 * This is a plain web bundle, not an Electron one, so it deliberately does not extend
 * webpack.config.base: that config sets a commonjs2 library target and marks the packaged app's
 * dependencies as externals, neither of which makes sense for something a Chromebook loads over
 * HTTP. Keeping it standalone also keeps it out of the way of upstream changes to the Electron
 * configs.
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

const srcRoomPath = path.join(webpackPaths.srcPath, 'room');
const distRoomPath = path.join(webpackPaths.distPath, 'room');

const configuration: webpack.Configuration = {
  devtool: 'source-map',

  mode: 'production',

  // An ordinary browser, with no access to Node or Electron.
  target: 'web',

  entry: [path.join(srcRoomPath, 'index.tsx')],

  output: {
    path: distRoomPath,
    // The server serves this bundle from the site root.
    publicPath: '/',
    filename: 'room.js',
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
            compilerOptions: {
              module: 'esnext',
            },
          },
        },
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
        /**
         * Original filenames, not webpack's hashed ones. Fluent UI asks for each icon subset by its
         * exact published filename (`fabric-icons-0-467ee27f.woff` and friends), so the emitted name
         * has to match what `src/room/fluentIcons.ts` points it at.
         */
        generator: {
          filename: 'fonts/[name][ext]',
        },
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg)$/i,
        type: 'asset/resource',
      },
    ],
  },

  resolve: {
    extensions: ['.js', '.jsx', '.json', '.ts', '.tsx'],
    modules: [webpackPaths.srcPath, 'node_modules'],
    alias: {
      /**
       * MODAQ 1.41.1 lists react and react-dom as regular dependencies rather than peers, so npm
       * installs a nested React 17 under node_modules/modaq. Two copies of React in one bundle
       * breaks hooks, so force everything onto the app's single React 18 copy.
       */
      react: path.join(webpackPaths.rootPath, 'node_modules/react'),
      'react-dom': path.join(webpackPaths.rootPath, 'node_modules/react-dom'),

      /**
       * The Fluent UI icon fonts, which `src/room/fluentIcons.ts` emits so they can be served from
       * this tournament's own server rather than Microsoft's CDN.
       *
       * An alias rather than a direct import because the package's `exports` map doesn't publish its
       * `fonts` directory. Aliasing to the directory keeps the files in step with whatever version of
       * @fluentui/font-icons-mdl2 is installed, which vendoring a copy into the repo would not:
       * Fluent requests each subset by a content-hashed filename that changes between versions.
       */
      'fluent-icon-fonts': path.join(webpackPaths.rootPath, 'node_modules/@fluentui/font-icons-mdl2/fonts'),
    },
  },

  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin(), new CssMinimizerPlugin()],
  },

  /**
   * MODAQ pulls in Fluent UI, which makes this bundle well over webpack's recommended size. That
   * advice is about pages served over the internet; this one is served from a computer in the same
   * room, so the size doesn't matter and the warnings are just noise.
   */
  performance: {
    hints: false,
  },

  plugins: [
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'production',
    }),

    new MiniCssExtractPlugin({
      filename: 'room.css',
    }),

    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: path.join(srcRoomPath, 'index.ejs'),
      minify: {
        collapseWhitespace: true,
        removeComments: false, // the CSP meta tag explanation is worth keeping
      },
    }),
  ],
};

export default configuration;
