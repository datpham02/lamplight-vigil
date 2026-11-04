// The public face of `src/weekly`: `docs/design.md` §14 made executable.
//
// `src/scenes` resolves a run's week through `weeklyRunAt()` or takes the
// unseeded `freePlayRun()`, and hands the result's `config` and `random` to
// `src/enemies`. Nothing outside this folder needs the hashes or the block
// schedule, but they are exported because §14.3 and §14.4 are a contract a
// server written against D4 must be able to reproduce, and because the
// conformance vectors in those sections are tests.

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
export {
  applyWeeklyModifier,
  changedRunConfigKeys,
  freePlayRun,
  weeklyModifierCells,
  weeklyRun,
  weeklyRunAt,
  weeklySpawnSeed,
  type ModifierCell,
  type RunSetup,
} from './run';
