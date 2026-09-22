/**
 * The anchor table for segment 7a: which step now keeps which old principle.
 *
 * Segment 7b adds a second table to the same module: the six `applies` lines of those same old
 * tables (`TABLE_APPLIES`), which 7a dropped and 7b puts into the main prompt of the step that
 * keeps the table. Same subject, same place - see `generator-applies.txt`.
 *
 * Why this file exists: the principles used to live in the card-level `generators` table plus a
 * `uses` reference on each node. Both are gone after 7a, so "who keeps which line" needs one
 * place a machine can check - otherwise the next ticket cannot answer it.
 *
 * The data itself is **Chinese** (the principle text and the reason), so it lives in
 * `generator-principles.txt`: `.githooks/checks/ascii.mjs` requires ASCII in code files,
 * `tests/**` included. This module only parses and shapes it, so it stays pure ASCII.
 *
 * Data format (one principle per line; `#` or `*` starts a comment):
 *   `text | anchor | card | node | why`
 *   - the first `|` splits the sentence from the rest; the rest may be omitted entirely
 *     (that principle has no anchor: it is probed by its whole sentence)
 *   - anchor: a short run that appears verbatim inside that sentence, and nowhere else in the cards
 *
 * Origin of the assignment (none of it is invented here):
 *   - ruling R58 `:822-826`: those four move into the main prompt of the step that works;
 *   - the lead 2026-09-20: the dungeon layer table splits by duty - `map` keeps "what the floor
 *     looks like", `outline` keeps the pacing;
 *   - the owner 2026-09-20: both orphan tables (long-night and night-watch) go into the story node.
 *   The ruling says "the map keeps the first two", which does not match the card (the dungeon
 *   spans `map` and `outline` there) - the owner re-decided against the card, see contract §5.2.
 */
import { readFileSync } from 'node:fs'

/** One principle line of the old generator tables */
export interface PrincipleLine {
  /** The sentence as the card wrote it */
  text: string
  /** The anchor used to find it in the card: the short run, or the whole sentence */
  anchor: string
  /** Which card file it belongs to (`cards/<card>.json`), when the table names one */
  card?: string
  /** Which node of that card carries it, when the table names one */
  node?: string
  /** Why it landed there */
  why?: string
}

const LINES: PrincipleLine[] = readFileSync('tests/support/generator-principles.txt', 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(
    (line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('*') && !line.startsWith('/'),
  )
  .map((line) => {
    const [text, anchor, card, node, why] = line.split('|').map((cell) => cell.trim())
    if (!text) throw new Error('bad row in the anchor table: ' + line)
    return { text, anchor: anchor || text, card, node, why }
  })

/** Every principle line of the old tables - the catalogue the contract counts */
export const MOVED_LINES: PrincipleLine[] = LINES

/** Only the lines whose target step the table names (those are the ones to check) */
export const PRINCIPLE_MOVES: Array<Required<PrincipleLine>> = LINES.filter(
  (line): line is Required<PrincipleLine> => Boolean(line.card && line.node && line.why),
)

/**
 * One `applies` line of the old generator tables - "when does this whole table apply".
 *
 * Segment 7b puts them into the main prompt of the step that keeps the table (owner ruling of
 * 2026-09-20, S0 section 7), NOT into an action's `whenToUse`. They were dropped in 7a and
 * nothing counted them, which is why they now have their own table here.
 */
export interface AppliesLine {
  /** The sentence as the old table wrote it */
  text: string
  /** The old table's name - it becomes a sub-heading in the prompt */
  table: string
  /** Which card file it belongs to (`cards/<card>.json`) */
  card: string
  /** The node whose main prompt must carry this line */
  node: string
  /** Every node whose prompt carries that table's rows (the dungeon table spans two) */
  spreads: string[]
  /** Why it landed there */
  why?: string
}

const APPLIES: AppliesLine[] = readFileSync('tests/support/generator-applies.txt', 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(
    (line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('*') && !line.startsWith('/'),
  )
  .map((line) => {
    const [text, table, card, node, spreads, why] = line.split('|').map((cell) => cell.trim())
    if (!text || !table || !card || !node || !spreads) {
      throw new Error('bad row in the applies table: ' + line)
    }
    return { text, table, card, node, spreads: spreads.split(' ').filter(Boolean), why }
  })

/** The six `applies` lines of the old tables - the catalogue the contract counts */
export const TABLE_APPLIES: AppliesLine[] = APPLIES

/** The three cards this segment covers */
export const CARDS = ['morningwind', 'long-night', 'night-watch']
