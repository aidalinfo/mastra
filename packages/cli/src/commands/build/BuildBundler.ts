import { FileService } from '@mastra/deployer/build';
import { Bundler } from '@mastra/deployer/bundler';
import fs from 'fs';
import path from 'path';

export class BuildBundler extends Bundler {
  private customEnvFile?: string;
  private userExternal: string[] = [];

  constructor(
    customEnvFile?: string,
    private projectRoot: string = process.cwd(),
  ) {
    super('Build');
    this.customEnvFile = customEnvFile;
    this.userExternal = this.getUserExternal();
  }

  /**
   * Read package.json
   */
  private getUserExternal(): string[] {
    try {
      const pkgPath = path.resolve(this.projectRoot, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (Array.isArray(pkg.mastraBuildExternal)) {
          console.log('Mastra External !!', pkg.mastraBuildExternal);
          return pkg.mastraBuildExternal;
        }
      }
    } catch (e) {
      // ignore
    }
    return [];
  }

  getEnvFiles(): Promise<string[]> {
    const possibleFiles = ['.env.production', '.env.local', '.env'];
    if (this.customEnvFile) {
      possibleFiles.unshift(this.customEnvFile);
    }

    try {
      const fileService = new FileService();
      const envFile = fileService.getFirstExistingFile(possibleFiles);

      return Promise.resolve([envFile]);
    } catch (err) {
      // ignore
    }

    return Promise.resolve([]);
  }

  async prepare(outputDirectory: string): Promise<void> {
    await super.prepare(outputDirectory);
  }

  async bundle(entryFile: string, outputDirectory: string, toolsPaths: string[]): Promise<void> {
    return this._bundle(this.getEntry(), entryFile, outputDirectory, toolsPaths, this.userExternal);
  }

  protected getEntry(): string {
    return `
    // @ts-ignore
    import { evaluate } from '@mastra/core/eval';
    import { AvailableHooks, registerHook } from '@mastra/core/hooks';
    import { TABLE_EVALS } from '@mastra/core/storage';
    import { checkEvalStorageFields } from '@mastra/core/utils';
    import { mastra } from '#mastra';
    import { createNodeServer } from '#server';
    // @ts-ignore
    await createNodeServer(mastra);

    registerHook(AvailableHooks.ON_GENERATION, ({ input, output, metric, runId, agentName, instructions }) => {
      evaluate({
        agentName,
        input,
        metric,
        output,
        runId,
        globalRunId: runId,
        instructions,
      });
    });

    if (mastra.getStorage()) {
      // start storage init in the background
      mastra.getStorage().init();
    }

    registerHook(AvailableHooks.ON_EVALUATION, async traceObject => {
      const storage = mastra.getStorage();
      if (storage) {
        // Check for required fields
        const logger = mastra?.getLogger();
        const areFieldsValid = checkEvalStorageFields(traceObject, logger);
        if (!areFieldsValid) return;

        await storage.insert({
          tableName: TABLE_EVALS,
          record: {
            input: traceObject.input,
            output: traceObject.output,
            result: JSON.stringify(traceObject.result || {}),
            agent_name: traceObject.agentName,
            metric_name: traceObject.metricName,
            instructions: traceObject.instructions,
            test_info: null,
            global_run_id: traceObject.globalRunId,
            run_id: traceObject.runId,
            created_at: new Date().toISOString(),
          },
        });
      }
    });
    `;
  }

  async lint(entryFile: string, outputDirectory: string, toolsPaths: string[]): Promise<void> {
    await super.lint(entryFile, outputDirectory, toolsPaths);
  }
}
