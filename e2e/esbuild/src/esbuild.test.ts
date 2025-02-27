import {
  checkFilesDoNotExist,
  checkFilesExist,
  cleanupProject,
  newProject,
  readFile,
  readJson,
  runCLI,
  runCommand,
  uniq,
  updateFile,
  updateProjectConfig,
  packageInstall,
  rmDist,
  runCommandUntil,
} from '@nrwl/e2e/utils';

describe('EsBuild Plugin', () => {
  let proj: string;

  beforeEach(() => (proj = newProject()));

  afterEach(() => cleanupProject());

  it('should setup and build projects using build', async () => {
    const myPkg = uniq('my-pkg');
    runCLI(`generate @nrwl/js:lib ${myPkg} --bundler=esbuild`);
    updateFile(`libs/${myPkg}/src/index.ts`, `console.log('Hello');\n`);
    updateProjectConfig(myPkg, (json) => {
      json.targets.build.options.assets = [`libs/${myPkg}/assets/*`];
      return json;
    });
    updateFile(`libs/${myPkg}/assets/a.md`, 'file a');
    updateFile(`libs/${myPkg}/assets/b.md`, 'file b');

    runCLI(`build ${myPkg}`);

    expect(runCommand(`node dist/libs/${myPkg}/index.js`)).toMatch(/Hello/);
    // main field should be set correctly in package.json
    checkFilesExist(`dist/libs/${myPkg}/package.json`);
    expect(runCommand(`node dist/libs/${myPkg}`)).toMatch(/Hello/);

    expect(readFile(`dist/libs/${myPkg}/assets/a.md`)).toMatch(/file a/);
    expect(readFile(`dist/libs/${myPkg}/assets/b.md`)).toMatch(/file b/);

    /* CJS format is not used by default, but passing --format=esm,cjs generates with it.
     */
    checkFilesDoNotExist(`dist/libs/${myPkg}/index.cjs`);
    runCLI(`build ${myPkg} --format=esm,cjs`);
    checkFilesExist(`dist/libs/${myPkg}/index.cjs`);

    /* Metafile is not generated by default, but passing --metafile generates it.
     */
    checkFilesDoNotExist(`dist/libs/${myPkg}/meta.json`);
    runCLI(`build ${myPkg} --metafile`);
    checkFilesExist(`dist/libs/${myPkg}/meta.json`);

    /* Type errors are turned on by default
     */
    updateFile(
      `libs/${myPkg}/src/index.ts`,
      `
      const x: number = 'a'; // type error
      console.log('Bye');
    `
    );
    expect(() => runCLI(`build ${myPkg}`)).toThrow();
    expect(() => runCLI(`build ${myPkg} --skipTypeCheck`)).not.toThrow();
    expect(runCommand(`node dist/libs/${myPkg}/index.js`)).toMatch(/Bye/);
  }, 300_000);

  it('should support bundling everything or only workspace libs', async () => {
    packageInstall('rambda', undefined, '~7.3.0', 'prod');
    packageInstall('lodash', undefined, '~4.14.0', 'prod');
    const parentLib = uniq('parent-lib');
    const childLib = uniq('child-lib');
    runCLI(`generate @nrwl/js:lib ${parentLib} --bundler=esbuild`);
    runCLI(`generate @nrwl/js:lib ${childLib} --buildable=false`);
    updateFile(
      `libs/${parentLib}/src/index.ts`,
      `
        // @ts-ignore
        import _ from 'lodash';
        import { greet } from '@${proj}/${childLib}';

        console.log(_.upperFirst('hello world'));
        console.log(greet());
      `
    );
    updateFile(
      `libs/${childLib}/src/index.ts`,
      `
        import { always } from 'rambda';
        export const greet = always('Hello from child lib');
      `
    );

    // Bundle child lib and third-party packages
    runCLI(`build ${parentLib}`);

    expect(
      readJson(`dist/libs/${parentLib}/package.json`).dependencies?.['dayjs']
    ).not.toBeDefined();
    let runResult = runCommand(`node dist/libs/${parentLib}/index.js`);
    expect(runResult).toMatch(/Hello world/);
    expect(runResult).toMatch(/Hello from child lib/);

    // Bundle only child lib
    runCLI(`build ${parentLib} --third-party=false`);

    expect(
      readJson(`dist/libs/${parentLib}/package.json`).dependencies
    ).toEqual({
      // Don't care about the versions, just that they exist
      rambda: expect.any(String),
      lodash: expect.any(String),
    });
    runResult = runCommand(`node dist/libs/${parentLib}/index.js`);
    expect(runResult).toMatch(/Hello world/);
    expect(runResult).toMatch(/Hello from child lib/);
  }, 300_000);

  it('should support non-bundle builds', () => {
    const myPkg = uniq('my-pkg');
    runCLI(`generate @nrwl/js:lib ${myPkg} --bundler=esbuild`);
    updateFile(`libs/${myPkg}/src/lib/${myPkg}.ts`, `console.log('Hello');\n`);
    updateFile(`libs/${myPkg}/src/index.ts`, `import './lib/${myPkg}.js';\n`);

    runCLI(`build ${myPkg} --bundle=false`);

    checkFilesExist(
      `dist/libs/${myPkg}/lib/${myPkg}.js`,
      `dist/libs/${myPkg}/index.js`
    );
    // Test files are excluded in tsconfig (e.g. tsconfig.lib.json)
    checkFilesDoNotExist(`dist/libs/${myPkg}/lib/${myPkg}.spec.js`);
    // Can run package (package.json fields are correctly generated)
    expect(runCommand(`node dist/libs/${myPkg}`)).toMatch(/Hello/);
  }, 300_000);

  it('should support new watch API in >= 0.17.0 and old watch API in < 0.17.0', async () => {
    const myPkg = uniq('my-pkg');
    runCLI(`generate @nrwl/js:lib ${myPkg} --bundler=esbuild`);
    updateFile(`libs/${myPkg}/src/index.ts`, `console.log('new API');\n`);

    let watchProcess = await runCommandUntil(
      `build ${myPkg} --bundle=false --watch`,
      (output) => {
        return output.includes('build succeeded');
      }
    );

    watchProcess.kill();

    // Check that the build is correct
    expect(runCommand(`node dist/libs/${myPkg}`)).toMatch(/new API/);

    // Now install legacy esbuild and do a build watch
    packageInstall('esbuild', undefined, '0.16.17');

    rmDist();

    watchProcess = await runCommandUntil(
      `build ${myPkg} --bundle=false --watch`,
      (output) => {
        return output.includes('build succeeded');
      }
    );

    watchProcess.kill();

    // Check that the build is correct
    expect(runCommand(`node dist/libs/${myPkg}`)).toMatch(/new API/);
  }, 120_000);

  it('should support additional entry points', () => {
    const myPkg = uniq('my-pkg');
    runCLI(`generate @nrwl/js:lib ${myPkg} --bundler=esbuild`);
    updateFile(`libs/${myPkg}/src/index.ts`, `console.log('main');\n`);
    updateFile(`libs/${myPkg}/src/extra.ts`, `console.log('extra');\n`);
    updateProjectConfig(myPkg, (json) => {
      json.targets.build.options.additionalEntryPoints = [
        `libs/${myPkg}/src/extra.ts`,
      ];
      return json;
    });

    runCommand(`build ${myPkg}`);

    expect(runCommand(`node dist/libs/${myPkg}/main.js`)).toMatch(/main/);
    expect(runCommand(`node dist/libs/${myPkg}/extra.js`)).toMatch(/extra/);
  });
});
