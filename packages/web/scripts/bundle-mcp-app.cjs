const { dirname, resolve } = require("node:path");
const { buildSync } = require("esbuild");

module.exports = function bundleMcpApp(source) {
  const { outputFiles, metafile } = buildSync({
    stdin: {
      contents: source,
      loader: "ts",
      resolveDir: dirname(this.resourcePath),
    },
    bundle: true,
    write: false,
    minify: true,
    metafile: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
  });
  for (const input of Object.keys(metafile.inputs)) {
    if (input !== "<stdin>") this.addDependency(resolve(input));
  }
  return `export default ${JSON.stringify(outputFiles[0].text)};`;
};
