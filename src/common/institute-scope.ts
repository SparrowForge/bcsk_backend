import type { Actor } from "./actor";
import { notFound } from "./errors/app-error";

/**
 * Institute isolation - the one place a query is bounded to the caller's institute.
 *
 * Every model that carries `instituteId` is read and written through these helpers:
 *
 *  - `inInstitute(actor)` is spread into a `where` (`{ ...inInstitute(actor), role: "TEACHER" }`)
 *    and into a create's `data`, so a list can never return, and a create can never file, a
 *    row under another institute.
 *  - `assertSameInstitute(actor, row, what)` guards a lookup by id. A row of another institute
 *    answers "not found" rather than "forbidden": confirming that an id exists elsewhere is
 *    itself a leak.
 *
 * A child table (a course's levels, a user's profile) is scoped through its parent's relation
 * rather than a column of its own: `{ course: inInstitute(actor) }`.
 */
export const inInstitute = (actor: Pick<Actor, "instituteId">) => ({ instituteId: actor.instituteId });

export function assertSameInstitute<T extends { instituteId: number }>(
  actor: Pick<Actor, "instituteId">,
  row: T | null | undefined,
  what: string,
): T {
  if (!row || row.instituteId !== actor.instituteId) throw notFound(what);
  return row;
}
