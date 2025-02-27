import { getProjects, removeProjectConfiguration } from '@nrwl/devkit';
import { createTreeWithEmptyWorkspace } from '@nrwl/devkit/testing';
import applicationGenerator from '../../generators/application/application';
import setupMf from '../../generators/setup-mf/setup-mf';
import addCypressMfWorkaround from './add-cypress-mf-workaround';

describe('Add Cypress MFE Workaround', () => {
  it('should add the cypress command to the index.ts for project that has associated e2e', async () => {
    // ARRANGE
    const tree = createTreeWithEmptyWorkspace({ layout: 'apps-libs' });
    await applicationGenerator(tree, {
      name: 'app1',
      routing: true,
    });

    await setupMf(tree, { appName: 'app1', mfType: 'host', routing: true });

    tree.write('apps/app1-e2e/src/support/index.ts', '');

    // ACT
    await addCypressMfWorkaround(tree);

    // ASSERT
    expect(tree.read('apps/app1-e2e/src/support/index.ts', 'utf-8')).toContain(
      "Cannot use 'import.meta' outside a module"
    );
  });

  it('should not add the cypress command to the index.ts for project that has does not have an associated e2e', async () => {
    // ARRANGE
    const tree = createTreeWithEmptyWorkspace({ layout: 'apps-libs' });
    await applicationGenerator(tree, {
      name: 'app1',
      routing: true,
    });

    await setupMf(tree, { appName: 'app1', mfType: 'host', routing: true });

    removeProjectConfiguration(tree, 'app1-e2e');
    tree.delete('apps/app1-e2e');

    // ACT
    await addCypressMfWorkaround(tree);

    // ASSERT
    expect(tree.exists('apps/app1-e2e/src/support/index.ts')).toBeFalsy();
  });
});
