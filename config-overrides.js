module.exports = function override(config, env) {
    // override webpack config...

    // Consolidate chunk files instead
    config.optimization.minimize = false;
    config.optimization.splitChunks = {
        cacheGroups: {
            default: false,
        },
    };
    // Move runtime into bundle instead of separate file
    config.optimization.runtimeChunk = false;

    // JS
    // config.output.filename = '[name].js';

    // CSS. "5" is MiniCssPlugin
    // const minifier = config.plugins.find((plugin) => plugin.constructor.name === "MiniCssExtractPlugin");
    // minifier.options.filename = 'static/css/[name].css';
    // minifier.options.chunkFilename = 'static/css/[name].chunk.css';
    // minifier.options.publicPath = '../';

    return config;
}
