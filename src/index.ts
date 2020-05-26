// @ts-ignore
import { ModuleFilenameHelpers, Compiler, compilation } from 'webpack';
import { RawSource, SourceMapSource } from 'webpack-sources';
import { startService, Service } from 'esbuild';

export default class ESBuildPlugin {
  options = {};
  static service: Service;

  constructor(options: { minify: boolean }) {
    this.options = options;
  }

  static async ensureService(enforce?: boolean) {
    if (!this.service || enforce) {
      this.service = await startService();
    }
  }

  async transformCode({
    source,
    file,
    devtool,
  }: {
    source: string;
    file: string;
    devtool: string | boolean | undefined;
  }) {
    let result: any;

    await ESBuildPlugin.ensureService();

    const transform = async () =>
      await ESBuildPlugin.service.transform(source, {
        ...this.options,
        sourcemap: !!devtool,
        sourcefile: file,
      });

    try {
      result = await transform();
    } catch (e) {
      if (e.message === 'The service is no longer running') {
        await ESBuildPlugin.ensureService(true);
        result = await transform();
      } else {
        throw e;
      }
    }

    return result;
  }

  apply(compiler: Compiler) {
    const matchObject = ModuleFilenameHelpers.matchObject.bind(undefined, {});
    const { devtool } = compiler.options;

    const plugin = 'ESBuild Plugin';
    compiler.hooks.compilation.tap(
      plugin,
      (compilation: compilation.Compilation) => {
        compilation.hooks.optimizeChunkAssets.tapPromise(
          plugin,
          async (chunks: compilation.Chunk[]) => {
            for (const chunk of chunks) {
              for (const file of chunk.files) {
                if (!matchObject(file)) {
                  continue;
                }
                if (!/\.m?js(\?.*)?$/i.test(file)) {
                  continue;
                }

                const assetSource = compilation.assets[file];
                const { source, map } = assetSource.sourceAndMap();
                const result = await this.transformCode({
                  source,
                  file,
                  devtool,
                });

                // @ts-ignore
                compilation.updateAsset(file, (old: string) => {
                  if (devtool) {
                    return new SourceMapSource(
                      result.js,
                      file,
                      result.jsSourceMap,
                      source,
                      map,
                      true,
                    );
                  } else {
                    return new RawSource(result.js || '');
                  }
                });
              }
            }
          },
        );
      },
    );

    compiler.hooks.done.tapPromise(plugin, async () => {
      if (ESBuildPlugin.service) {
        await ESBuildPlugin.service.stop();
      }
    });
  }
}
