/**
 * Crash-matrix child (Doc 24 P3 acceptance): opens a real store and writes
 * baselines in a loop, printing ITER:<n> after each commit. The parent test
 * SIGKILLs it at an arbitrary point; the parent then reopens the store and
 * asserts zero visible partial state. Imports the BUILT dist — CI builds
 * before testing.
 */

const [, , storeDir] = process.argv;
const {
  KeelStore,
  canonicalBytes,
  createCapturingBaseline,
  noopLogger,
  sealBaseline,
  ulid,
  withSnapshotRef,
} = await import('../../../../dist/index.js');

const store = await KeelStore.open({ directory: storeDir, logger: noopLogger });
console.log('READY');

const provenance = {
  gitCommit: null,
  gitDirty: true,
  configHash: 'c'.repeat(64),
  environment: {
    os: 'linux',
    arch: 'x64',
    runtimeName: 'node',
    runtimeVersion: '22.0.0',
    icuVersion: '76.1',
    interceptorVersions: {},
  },
  keelVersion: '0.0.1',
  normalizationRulesetVersion: 'rules/1',
};

for (let iteration = 0; ; iteration++) {
  const snapshot = await store.objects.put(canonicalBytes({ snapshot: iteration, noise: ulid() }));
  let baseline = createCapturingBaseline({ id: ulid(), label: 'crash-test', provenance });
  baseline = withSnapshotRef(baseline, `probe-${String(iteration)}`, snapshot.hash);
  await store.baselines.save(sealBaseline(baseline, 1_720_000_000_000 + iteration));
  console.log(`ITER:${String(iteration)}`);
}
