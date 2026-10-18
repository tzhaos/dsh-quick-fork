/**
 * Host half of the quick-fork bundle.
 *
 * The side conversation itself is a normal DSH Session created through the
 * public session fork API. The Host process has nothing to install; this no-op
 * entry exists so the Client module registry discovers the browser bundle.
 */
export function apply() {}
