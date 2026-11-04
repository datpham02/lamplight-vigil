// The public face of `src/weekly`: `docs/design.md` §14 made executable.
//
// `src/scenes` resolves a run's week through `weeklyRunAt()` or takes the
// unseeded `freePlayRun()`, and hands the result's `config` and `random` to
// `src/enemies`. Nothing outside this folder needs the hashes or the block
// schedule, but they are exported because §14.3 and §14.4 are a contract a
// server written against D4 must be able to reproduce, and because the
// conformance vectors in those sections are tests.
//
// The §14.5 table and the override layer are not re-exported from here: they are
// `src/config`'s, and `tools/throughput-sim.ts` reads them straight from there.
// One name for one thing, so the sweep and a run cannot drift apart.

export { fnv1a32, mulberry32, seededUnitRandom, type RunRandom } from './seed';
export { msRemainingInWeek, weekIndex, weekKey } from './weekKey';
export {
  BLOCK_LENGTH,
  blockOrder,
  rawBlockOrder,
  resolveWeek,
  resolveWeekAt,
  type ResolvedWeek,
} from './schedule';
export { freePlayRun, weeklyRun, weeklyRunAt, weeklySpawnSeed, type RunSetup } from './run';
